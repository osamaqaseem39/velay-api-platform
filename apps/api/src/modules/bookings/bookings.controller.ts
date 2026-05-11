import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import {
  COURT_KINDS,
  type CourtKind,
} from './types/booking.types';
import { BookingAvailabilityQueryDto } from './dto/booking-availability-query.dto';
import { CourtSlotGridQueryDto } from './dto/court-slot-grid-query.dto';
import { CourtSlotsQueryDto } from './dto/court-slots-query.dto';
import { LocationFacilitySlotsQueryDto } from './dto/location-facility-slots-query.dto';
import { LocationFacilitySlotPickQueryDto } from './dto/location-facility-slot-pick-query.dto';
import { LocationLiveFacilitiesQueryDto } from './dto/location-live-facilities-query.dto';
import { LocationEmptySlots30DaysQueryDto } from './dto/location-empty-slots-30-days-query.dto';
import type { LocationLiveFacilitiesView } from './dto/location-live-facilities-view.dto';
import { CurrentTenant } from '../../tenancy/tenant-context.decorator';
import { TenantContext } from '../../tenancy/tenant-context.interface';
import { BookingsService, BookingApiRow } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { GenerateFacilitySlotsDto } from './dto/generate-facility-slots.dto';
import { PatchFacilitySlotDto } from './dto/patch-facility-slot.dto';
import { SetCourtSlotBlockDto } from './dto/set-court-slot-block.dto';
import { EditBookingFacilitySlotsDto } from './dto/edit-booking-facility-slots.dto';
import { CreateTimeSlotTemplateDto } from './dto/create-time-slot-template.dto';
import { UpdateTimeSlotTemplateDto } from './dto/update-time-slot-template.dto';
import { Roles } from '../iam/authz/roles.decorator';
import { RolesGuard } from '../iam/authz/roles.guard';
import { TimeSlotTemplatesService } from './time-slot-templates/time-slot-templates.service';
import { logBookingsCreateFailure } from './utils/log-bookings-create-failure';

function normalizeKind(kind: string): CourtKind | string {
  if (kind === 'futsal_court' || kind === 'cricket_court') return 'turf_court';
  return kind;
}

@Controller('bookings')
export class BookingsController {
  private readonly logger = new Logger(BookingsController.name);

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly timeSlotTemplatesService: TimeSlotTemplatesService,
  ) {}

  private getTenantUuidOrNull(tenant: TenantContext): string | null {
    const tenantId = tenant?.tenantId?.trim() ?? '';
    return isUUID(tenantId, 4) ? tenantId : null;
  }

  private requireTenantUuid(tenant: TenantContext): string | null {
    return this.getTenantUuidOrNull(tenant);
  }

  private async resolveTenantForCourt(
    tenant: TenantContext,
    courtKind: CourtKind,
    courtId: string,
  ): Promise<string | null> {
    const tenantId = this.getTenantUuidOrNull(tenant);
    if (tenantId) return tenantId;
    return this.bookingsService.resolveTenantIdByCourt(courtKind, courtId);
  }

  private async resolveTenantForBooking(
    tenant: TenantContext,
    bookingId: string,
  ): Promise<string | null> {
    const tenantId = this.getTenantUuidOrNull(tenant);
    if (tenantId) return tenantId;
    return this.bookingsService.resolveTenantIdByBooking(bookingId);
  }

  private async resolveTenantForTemplate(
    tenant: TenantContext,
    templateId: string,
  ): Promise<string | null> {
    const tenantId = this.getTenantUuidOrNull(tenant);
    if (tenantId) return tenantId;
    return this.bookingsService.resolveTenantIdByTimeSlotTemplate(templateId);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin')
  list(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
    @Query('locationId') locationId?: string,
  ): Promise<BookingApiRow[]> {
    const userId = (req as Request & { userId?: string }).userId?.trim();
    if (!userId) throw new UnauthorizedException('Missing user');
    return this.bookingsService.list(
      userId,
      this.getTenantUuidOrNull(tenant) ?? undefined,
      locationId,
    );
  }

  @Get('availability')
  availabilityByTime(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: BookingAvailabilityQueryDto,
  ) {
    const tenantId = this.getTenantUuidOrNull(tenant);
    if (!tenantId) {
      return {
        date: query.date,
        startTime: query.startTime,
        endTime: query.endTime,
        sportType: query.sportType,
        availableCourts: [],
        bookedSlots: [],
      };
    }
    return this.bookingsService.getAvailabilityByTime(tenantId, query);
  }

  @Get('time-slot-templates')
  listTimeSlotTemplates(@CurrentTenant() tenant: TenantContext) {
    const tenantId = this.getTenantUuidOrNull(tenant);
    if (!tenantId) return [];
    return this.timeSlotTemplatesService.list(tenantId);
  }

  @Post('time-slot-templates')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async createTimeSlotTemplate(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateTimeSlotTemplateDto,
  ) {
    const tenantId = this.getTenantUuidOrNull(tenant);
    if (!tenantId) {
      throw new BadRequestException(
        'X-Tenant-Id is optional for reads but required to create a template.',
      );
    }
    return this.timeSlotTemplatesService.create(tenantId, dto);
  }

  @Patch('time-slot-templates/:templateId')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async updateTimeSlotTemplate(
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: UpdateTimeSlotTemplateDto,
  ) {
    const tenantId = await this.resolveTenantForTemplate(tenant, templateId);
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for template.');
    }
    return this.timeSlotTemplatesService.update(tenantId, templateId, dto);
  }

  @Delete('time-slot-templates/:templateId')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async deleteTimeSlotTemplate(
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', ParseUUIDPipe) templateId: string,
  ) {
    const tenantId = await this.resolveTenantForTemplate(tenant, templateId);
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for template.');
    }
    return this.timeSlotTemplatesService.remove(tenantId, templateId);
  }

  @Get('courts/:courtKind/:courtId/slots')
  async courtSlots(
    @CurrentTenant() tenant: TenantContext,
    @Param('courtKind') rawCourtKind: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Query() query: CourtSlotsQueryDto,
  ) {
    const courtKind = normalizeKind(rawCourtKind);
    if (!COURT_KINDS.includes(courtKind as CourtKind)) {
      throw new BadRequestException(
        `courtKind must be one of: ${COURT_KINDS.join(', ')}`,
      );
    }
    const tenantId = await this.resolveTenantForCourt(
      tenant,
      courtKind as CourtKind,
      courtId,
    );
    if (!tenantId) {
      return {
        date: query.date,
        kind: courtKind as CourtKind,
        courtId,
        slots: [],
      };
    }
    return this.bookingsService.getCourtSlots(tenantId, {
      kind: courtKind as CourtKind,
      courtId,
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      availableOnly: true,
    });
  }

  @Get('courts/:courtKind/:courtId/slot-grid')
  async courtSlotGrid(
    @CurrentTenant() tenant: TenantContext,
    @Param('courtKind') rawCourtKind: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Query() query: CourtSlotGridQueryDto,
  ) {
    const courtKind = normalizeKind(rawCourtKind);
    if (!COURT_KINDS.includes(courtKind as CourtKind)) {
      throw new BadRequestException(
        `courtKind must be one of: ${COURT_KINDS.join(', ')}`,
      );
    }
    const tenantId = await this.resolveTenantForCourt(
      tenant,
      courtKind as CourtKind,
      courtId,
    );
    if (!tenantId) {
      return {
        date: query.date,
        kind: courtKind as CourtKind,
        courtId,
        gridStartTime: query.startTime ?? '00:00',
        gridEndTime: query.endTime ?? '24:00',
        segments: [],
      };
    }
    return this.bookingsService.getCourtSlotGrid(tenantId, {
      kind: courtKind as CourtKind,
      courtId,
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      availableOnly: query.availableOnly === 'true',
    });
  }

  @Get('locations/:locationId/facilities/live')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async locationLiveFacilities(
    @Req() req: Request,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Query() query: LocationLiveFacilitiesQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<LocationLiveFacilitiesView> {
    const userId = (req as Request & { userId?: string }).userId?.trim();
    if (!userId) {
      throw new UnauthorizedException('Missing user');
    }
    return this.bookingsService.getLocationLiveFacilities({
      requesterUserId: userId,
      tenantId: this.getTenantUuidOrNull(tenant) ?? undefined,
      locationId,
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      courtType: query.courtType,
    });
  }

  @Get('locations/:locationId/facilities/available-slots')
  async locationFacilitiesAvailableSlots(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Query() query: LocationFacilitySlotsQueryDto,
  ) {
    return this.bookingsService.getLocationFacilitiesAvailableSlots({
      locationId,
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      courtType: query.courtType,
      tableTennisPlayType: query.tableTennisPlayType,
    });
  }

  @Get('locations/:locationId/facilities/available-for-slot')
  async locationFacilitiesAvailableForSlot(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Query() query: LocationFacilitySlotPickQueryDto,
  ) {
    return this.bookingsService.getLocationFacilitiesAvailableForSlot({
      locationId,
      date: query.date,
      startTime: query.startTime,
      endTime: query.endTime,
      courtType: query.courtType,
      tableTennisPlayType: query.tableTennisPlayType,
    });
  }

  @Get('locations/:locationId/facilities/empty-slots-30-days')
  async locationEmptySlots30Days(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Query() query: LocationEmptySlots30DaysQueryDto,
  ) {
    return this.bookingsService.getLocationEmptySlots30Days({
      locationId,
      courtType: query.courtType,
    });
  }

  @Put('courts/:courtKind/:courtId/slot-blocks')
  async setCourtSlotBlock(
    @CurrentTenant() tenant: TenantContext,
    @Param('courtKind') rawCourtKind: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Body() dto: SetCourtSlotBlockDto,
  ) {
    const courtKind = normalizeKind(rawCourtKind);
    if (!COURT_KINDS.includes(courtKind as CourtKind)) {
      throw new BadRequestException(
        `courtKind must be one of: ${COURT_KINDS.join(', ')}`,
      );
    }
    const tenantId = await this.resolveTenantForCourt(
      tenant,
      courtKind as CourtKind,
      courtId,
    );
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for court.');
    }
    return this.bookingsService.setCourtSlotBlock(tenantId, {
      kind: courtKind as CourtKind,
      courtId,
      date: dto.date,
      startTime: dto.startTime,
      blocked: dto.blocked,
    });
  }

  @Post('courts/:courtKind/:courtId/facility-slots/generate')
  async generateFacilityDaySlots(
    @CurrentTenant() tenant: TenantContext,
    @Param('courtKind') rawCourtKind: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Body() dto: GenerateFacilitySlotsDto,
  ) {
    const courtKind = normalizeKind(rawCourtKind);
    if (!COURT_KINDS.includes(courtKind as CourtKind)) {
      throw new BadRequestException(
        `courtKind must be one of: ${COURT_KINDS.join(', ')}`,
      );
    }
    const tenantId = await this.resolveTenantForCourt(
      tenant,
      courtKind as CourtKind,
      courtId,
    );
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for court.');
    }
    return this.bookingsService.generateDayFacilitySlots(tenantId, {
      kind: courtKind as CourtKind,
      courtId,
      date: dto.date,
    });
  }

  @Patch('courts/:courtKind/:courtId/facility-slots')
  async patchFacilitySlot(
    @CurrentTenant() tenant: TenantContext,
    @Param('courtKind') rawCourtKind: string,
    @Param('courtId', ParseUUIDPipe) courtId: string,
    @Body() dto: PatchFacilitySlotDto,
  ) {
    const courtKind = normalizeKind(rawCourtKind);
    if (!COURT_KINDS.includes(courtKind as CourtKind)) {
      throw new BadRequestException(
        `courtKind must be one of: ${COURT_KINDS.join(', ')}`,
      );
    }
    const tenantId = await this.resolveTenantForCourt(
      tenant,
      courtKind as CourtKind,
      courtId,
    );
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for court.');
    }
    return this.bookingsService.patchFacilitySlot(tenantId, {
      kind: courtKind as CourtKind,
      courtId,
      date: dto.date,
      startTime: dto.startTime,
      status: dto.status,
    });
  }

  @Get(':bookingId')
  async getOne(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    const userId = (req as Request & { userId?: string }).userId?.trim();
    const tenantId = await this.resolveTenantForBooking(tenant, bookingId);
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for booking.');
    }
    return this.bookingsService.getOne(tenantId, bookingId, userId);
  }

  @Post()
  async create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateBookingDto,
  ) {
    try {
      const tenantIdFromHeader = this.getTenantUuidOrNull(tenant);
      const firstItem = dto.items?.[0];
      const resolvedFromCourt = firstItem
        ? await this.bookingsService.resolveTenantIdByCourt(
            firstItem.courtKind,
            firstItem.courtId,
          )
        : null;
      const tenantId = tenantIdFromHeader ?? resolvedFromCourt;
      if (!tenantId) {
        throw new BadRequestException(
          'Unable to resolve tenant. Provide a valid court in items or X-Tenant-Id.',
        );
      }
      const result = await this.bookingsService.create(tenantId, dto);

      // Explicit check in controller as requested: block slots if booking is active
      if (result.bookingStatus === 'confirmed' || result.bookingStatus === 'live') {
        await this.bookingsService.syncFacilitySlotsStatusById(
          tenantId,
          result.bookingId,
        );
      }

      return result;
    } catch (err) {
      logBookingsCreateFailure(
        this.logger,
        'POST /bookings (create)',
        err,
      );
      throw err;
    }
  }

  @Patch(':bookingId')
  async update(
    @CurrentTenant() tenant: TenantContext,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: UpdateBookingDto,
  ) {
    const tenantId = await this.resolveTenantForBooking(tenant, bookingId);
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for booking.');
    }
    const result = await this.bookingsService.update(tenantId, bookingId, dto);

    // Explicit check in controller as requested: update slots status
    await this.bookingsService.syncFacilitySlotsStatusById(tenantId, result.bookingId);

    return result;
  }

  @Patch(':bookingId/facility-slots')
  async editBookingFacilitySlots(
    @CurrentTenant() tenant: TenantContext,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: EditBookingFacilitySlotsDto,
  ) {
    const tenantId = await this.resolveTenantForBooking(tenant, bookingId);
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for booking.');
    }
    return this.bookingsService.editBookingFacilitySlots(
      tenantId,
      bookingId,
      dto.blocked ?? false,
      dto.addOnMinutes,
    );
  }

  @Delete(':bookingId')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    const tenantId = await this.resolveTenantForBooking(tenant, bookingId);
    if (!tenantId) {
      throw new BadRequestException('Unable to resolve tenant for booking.');
    }
    return this.bookingsService.remove(tenantId, bookingId);
  }
}

