import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { IamService } from '../iam/iam.service';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  Brackets,
  DeepPartial,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { PadelCourt } from '../arena/padel-court/entities/padel-court.entity';
import { TableTennisCourt } from '../arena/table-tennis-court/entities/table-tennis-court.entity';
import { TurfCourt } from '../arena/turf/entities/turf-court.entity';
import { User } from '../iam/entities/user.entity';
import { TenantTimeSlotTemplateLine } from './entities/tenant-time-slot-template-line.entity';
import {
  type BookingItemStatus,
  type BookingSportType,
  type BookingStatus,
  type BookingViewStatus,
  type CourtKind,
  type PaymentMethod,
  type PaymentStatus,
} from './types/booking.types';
import type { CreateBookingDto } from './dto/create-booking.dto';
import type { CreateBookingItemDto } from './dto/create-booking-item.dto';
import type { UpdateBookingDto } from './dto/update-booking.dto';
import { BusinessLocation } from '../businesses/entities/business-location.entity';
import { Business } from '../businesses/entities/business.entity';
import type { PlacePadelBookingDto } from './dto/place-padel-booking.dto';
import type {
  LiveFacilitiesSlotsPayload,
  LivePadelCourtDto,
  LiveTurfCourtDto,
  LocationLiveFacilitiesView,
} from './dto/location-live-facilities-view.dto';
import {
  addDaysYmd,
  buildPlaySnapshot,
  type FacilityPlaySnapshot,
  ymdInTimeZone,
} from './utils/facility-live-snapshot.util';
import { CourtFacilitySlot, CourtFacilitySlotStatus } from './entities/court-facility-slot.entity';
import { BookingItem } from './entities/booking-item.entity';
import { CourtSlotBookingBlock } from './entities/court-slot-booking-block.entity';
import { Booking } from './entities/booking.entity';
import { TenantTimeSlotTemplate } from './entities/tenant-time-slot-template.entity';

function dec(n: number): string {
  return Number(n).toFixed(2);
}

function numFromDec(v: string): number {
  return Number.parseFloat(v);
}

/**
 * When paid amount matches the order total, mark payment as settled unless already in a terminal failure/refund state.
 */
function harmonizePaymentStatusWithAmounts(b: {
  totalAmount: string;
  paidAmount: string;
  paymentStatus: PaymentStatus;
}): void {
  if (b.paymentStatus === 'refunded' || b.paymentStatus === 'failed') return;
  const total = numFromDec(b.totalAmount);
  const paid = numFromDec(b.paidAmount);
  if (paid <= 0) {
    b.paymentStatus = 'pending';
  } else if (paid < total) {
    b.paymentStatus = 'partially_paid';
  } else if (paid === total) {
    b.paymentStatus = 'paid';
  }
}

function toMinutes(time: any, isEndTime = false): number {
  if (typeof time !== 'string' || !time.includes(':')) return 0;
  if (time === '24:00' || (time === '00:00' && isEndTime)) return 24 * 60;
  const [hRaw, mRaw] = time.split(':');
  return Number(hRaw || 0) * 60 + Number(mRaw || 0);
}

function minutesToTimeString(m: number): string {
  if (m >= 24 * 60) return '24:00';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatDateOnly(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffMinutes(startTime: string, endTime: string): number {
  const start = toMinutes(startTime, false);
  let end = toMinutes(endTime, true);
  if (end <= start) end += 24 * 60;
  return end - start;
}

type TableTennisPlayType = 'singles' | 'doubles';

function getCurrentDateInKarachi(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function getCurrentMinutesInKarachi(): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hourText = '00', minuteText = '00'] = formatter
    .format(new Date())
    .split(':');
  return Number(hourText) * 60 + Number(minuteText);
}

export type BookingApiRow = {
  bookingId: string;
  arenaId: string;
  arenaName?: string;
  userId: string;
  user?: {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  sportType: BookingSportType;
  bookingDate: string;
  items: Array<{
    id: string;
    date?: string;
    courtKind: CourtKind;
    courtId: string;
    slotId?: string;
    startTime: string;
    endTime: string;
    price: number;
    currency: string;
    status: BookingItemStatus;
  }>;
  pricing: {
    subTotal: number;
    discount: number;
    tax: number;
    totalAmount: number;
  };
  payment: {
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    transactionId?: string;
    paidAt?: string;
    paidAmount: number;
    remainingAmount: number;
  };
  bookingStatus: BookingViewStatus;
  notes?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PadelCourt)
    private readonly padelRepo: Repository<PadelCourt>,
    @InjectRepository(TurfCourt)
    private readonly turfRepo: Repository<TurfCourt>,
    @InjectRepository(TableTennisCourt)
    private readonly tableTennisRepo: Repository<TableTennisCourt>,
    @InjectRepository(BusinessLocation)
    private readonly locationRepo: Repository<BusinessLocation>,
    @InjectRepository(Business)
    private readonly businessRepo: Repository<Business>,
    @InjectRepository(CourtSlotBookingBlock)
    private readonly slotBlockRepo: Repository<CourtSlotBookingBlock>,
    @InjectRepository(CourtFacilitySlot)
    private readonly facilitySlotRepo: Repository<CourtFacilitySlot>,
    @InjectRepository(TenantTimeSlotTemplate)
    private readonly slotTemplateRepo: Repository<TenantTimeSlotTemplate>,
    @InjectRepository(TenantTimeSlotTemplateLine)
    private readonly slotTemplateLineRepo: Repository<TenantTimeSlotTemplateLine>,
    private readonly iamService: IamService,
  ) {}

  private readonly logger = new Logger(BookingsService.name);
  private static readonly MAX_BOOKING_DAYS_AHEAD = 14;
  private static readonly DEFAULT_SLOT_STEP_MINUTES = 60;
  private static readonly SLOT_OVERLAP_GRACE_MINUTES = 15;

  private computePayableAmount(
    subTotal: number,
    discount: number,
    tax: number,
  ): number {
    return Math.max(0, Number((subTotal - discount + tax).toFixed(2)));
  }

  private assertPaidAmountWithinPayable(
    paidAmount: number,
    payableAmount: number,
  ): void {
    if (paidAmount > payableAmount) {
      throw new BadRequestException(
        'paidAmount cannot be greater than payable amount',
      );
    }
  }

  private assertBookingDateInAllowedWindow(bookingDate: string): void {
    const requested = formatDateOnly(bookingDate);
    const today = getCurrentDateInKarachi();
    const lastAllowed = addDays(
      today,
      BookingsService.MAX_BOOKING_DAYS_AHEAD - 1,
    );
    if (requested < today || requested > lastAllowed) {
      throw new BadRequestException(
        `Bookings are allowed only from ${today} to ${lastAllowed}`,
      );
    }
  }

  async resolveTenantIdByCourt(
    kind: CourtKind,
    courtId: string,
  ): Promise<string | null> {
    if (kind === 'padel_court') {
      const row = await this.padelRepo.findOne({
        where: { id: courtId },
        select: ['tenantId'],
      });
      return row?.tenantId ?? null;
    }
    if (kind === 'turf_court') {
      const row = await this.turfRepo.findOne({
        where: { id: courtId },
        select: ['tenantId'],
      });
      return row?.tenantId ?? null;
    }
    if (kind === 'table_tennis_court') {
      const row = await this.tableTennisRepo.findOne({
        where: { id: courtId },
        select: ['tenantId'],
      });
      return row?.tenantId ?? null;
    }
    return null;
  }

  async resolveTenantIdByBooking(bookingId: string): Promise<string | null> {
    const row = await this.bookingRepo.findOne({
      where: { id: bookingId },
      select: ['tenantId'],
    });
    return row?.tenantId ?? null;
  }

  async resolveTenantIdByTimeSlotTemplate(
    templateId: string,
  ): Promise<string | null> {
    const row = await this.slotTemplateRepo.findOne({
      where: { id: templateId },
      select: ['tenantId'],
    });
    return row?.tenantId ?? null;
  }

  async resolveTenantIdByLocation(locationId: string): Promise<string | null> {
    const loc = await this.locationRepo.findOne({
      where: { id: locationId },
      select: ['businessId'],
    });
    if (!loc) return null;
    const business = await this.businessRepo.findOne({
      where: { id: loc.businessId },
      select: ['tenantId'],
    });
    return business?.tenantId ?? null;
  }

  private async resolveLocationMappingBatch(bookings: Booking[]): Promise<{
    locationsMap: Record<string, string>;
    courtToLocationMap: Record<string, string>;
    locationTimeZoneMap: Record<string, string>;
  }> {
    const locationsMap: Record<string, string> = {};
    const courtToLocationMap: Record<string, string> = {};
    const locationTimeZoneMap: Record<string, string> = {};

    const padelIds = new Set<string>();
    const turfIds = new Set<string>();
    const tableTennisIds = new Set<string>();

    for (const b of bookings) {
      for (const item of b.items || []) {
        if (item.courtKind === 'padel_court') padelIds.add(item.courtId);
        else if (item.courtKind === 'turf_court') turfIds.add(item.courtId);
        else if (item.courtKind === 'table_tennis_court')
          tableTennisIds.add(item.courtId);
      }
    }

    if (padelIds.size > 0) {
      const padels = await this.padelRepo.find({
        where: { id: In([...padelIds]) },
        select: ['id', 'businessLocationId'],
      });
      for (const p of padels) {
        if (p.businessLocationId)
          courtToLocationMap[p.id] = p.businessLocationId;
      }
    }

    if (turfIds.size > 0) {
      const turfs = await this.turfRepo.find({
        where: { id: In([...turfIds]) },
        select: ['id', 'branchId'],
      });
      for (const t of turfs) {
        if (t.branchId) courtToLocationMap[t.id] = t.branchId;
      }
    }

    if (tableTennisIds.size > 0) {
      const rows = await this.tableTennisRepo.find({
        where: { id: In([...tableTennisIds]) },
        select: ['id', 'businessLocationId'],
      });
      for (const t of rows) {
        if (t.businessLocationId) courtToLocationMap[t.id] = t.businessLocationId;
      }
    }

    const locationIds = new Set(Object.values(courtToLocationMap));
    if (locationIds.size > 0) {
      const locations = await this.locationRepo.find({
        where: { id: In([...locationIds]) },
        select: ['id', 'name', 'timezone'],
      });
      for (const loc of locations) {
        locationsMap[loc.id] = loc.name;
        const tz = loc.timezone?.trim();
        if (tz) locationTimeZoneMap[loc.id] = tz;
      }
    }

    return { locationsMap, courtToLocationMap, locationTimeZoneMap };
  }

  private async resolveLocationMapping(booking: Booking): Promise<{
    locationsMap: Record<string, string>;
    courtToLocationMap: Record<string, string>;
    locationTimeZoneMap: Record<string, string>;
  }> {
    return this.resolveLocationMappingBatch([booking]);
  }

  /** Start instant for overlap / ordering; prefers persisted `startDatetime`. */
  private itemPlayStartMs(item: BookingItem, bookingBookingDate: string): number {
    if (item.startDatetime) return item.startDatetime.getTime();
    const d = formatDateOnly(item.date ?? bookingBookingDate);
    return this.toSlotDateTimes(d, item.startTime, item.endTime).startDatetime.getTime();
  }

  private sortBookingItemsForTimeline(booking: Booking): BookingItem[] {
    const arr = [...(booking.items ?? [])];
    const bd = formatDateOnly(booking.bookingDate);
    arr.sort((a, b) => this.itemPlayStartMs(a, bd) - this.itemPlayStartMs(b, bd));
    return arr;
  }

  private toApi(
    booking: Booking,
    locationsMap: Record<string, string> = {},
    courtToLocationMap: Record<string, string> = {},
    locationTimeZoneMap: Record<string, string> = {},
    opts?: { projectLiveViewStatus?: boolean },
  ): BookingApiRow {
    const timelineItems = this.sortBookingItemsForTimeline(booking);
    const first = timelineItems[0];
    const courtId = first?.courtId;
    const locationId = courtId ? courtToLocationMap[courtId] : undefined;
    const arenaId = locationId || booking.tenantId;

    return {
      bookingId: booking.id,
      arenaId,
      arenaName: locationId ? locationsMap[locationId] : undefined,
      userId: booking.userId,
      user: booking.user
        ? {
            fullName: booking.user.fullName,
            email: booking.user.email,
            phone: booking.user.phone,
          }
        : undefined,
      sportType: booking.sportType,
      bookingDate: formatDateOnly(booking.bookingDate),
      items: timelineItems.map((it) => ({
        id: it.id,
        date: it.date,
        courtKind: it.courtKind,
        courtId: it.courtId,
        slotId: it.slotId,
        startTime: it.startTime,
        endTime: it.endTime,
        price: numFromDec(it.price),
        currency: it.currency,
        status: it.itemStatus,
      })),
      pricing: {
        subTotal: numFromDec(booking.subTotal),
        discount: numFromDec(booking.discount),
        tax: numFromDec(booking.tax),
        totalAmount: numFromDec(booking.totalAmount),
      },
      payment: {
        paymentStatus: booking.paymentStatus,
        paymentMethod: booking.paymentMethod,
        transactionId: booking.transactionId,
        paidAt: booking.paidAt?.toISOString(),
        paidAmount: numFromDec(booking.paidAmount),
        remainingAmount: numFromDec(booking.totalAmount) - numFromDec(booking.paidAmount),
      },
      bookingStatus:
        opts?.projectLiveViewStatus === false
          ? booking.bookingStatus
          : this.resolveBookingViewStatus(
              booking,
              locationId ? locationTimeZoneMap[locationId] : undefined,
            ),
      notes: booking.notes,
      cancellationReason: booking.cancellationReason,
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    };
  }

  private resolveBookingViewStatus(
    booking: Booking,
    locationTimeZone?: string,
  ): BookingViewStatus {
    void locationTimeZone;
    return booking.bookingStatus;
  }

  async list(requesterUserId: string, tenantId?: string, locationId?: string): Promise<BookingApiRow[]> {
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterUserId, ['platform-owner']);
    const constraint = await this.iamService.getLocationAdminConstraint(requesterUserId);
    
    const qb = this.bookingRepo.createQueryBuilder('b')
      .leftJoinAndSelect('b.items', 'items')
      .leftJoinAndSelect('b.user', 'user');

    if (tenantId) {
      qb.andWhere('b.tenantId = :tenantId', { tenantId });
    } else if (!isPlatformOwner) {
      throw new UnauthorizedException('Tenant ID is required');
    }

    const effectiveLocationId = constraint || locationId;

    if (effectiveLocationId) {
      const padels = await this.padelRepo.find({
        where: { businessLocationId: effectiveLocationId },
        select: ['id'],
      });
      const turfs = await this.turfRepo.find({
        where: { branchId: effectiveLocationId },
        select: ['id'],
      });
      const courtIds = [...padels.map((p) => p.id), ...turfs.map((t) => t.id)];
      if (courtIds.length === 0) return [];
      
      qb.andWhere((sub) => {
        const subQuery = sub.subQuery()
          .select('i.bookingId')
          .from(BookingItem, 'i')
          .where('i.courtId IN (:...courtIds)', { courtIds })
          .getQuery();
        return 'b.id IN ' + subQuery;
      });
    }

    qb.orderBy('b.createdAt', 'DESC');
    const rows = await qb.getMany();

    const { locationsMap, courtToLocationMap, locationTimeZoneMap } =
      await this.resolveLocationMappingBatch(rows);

    return rows.map((b) =>
      this.toApi(b, locationsMap, courtToLocationMap, locationTimeZoneMap),
    );
  }

  async listByUserForProfile(userId: string): Promise<BookingApiRow[]> {
    const rows = await this.bookingRepo.find({
      where: { userId },
      relations: ['items', 'user'],
      order: { createdAt: 'DESC' },
    });

    const { locationsMap, courtToLocationMap, locationTimeZoneMap } =
      await this.resolveLocationMappingBatch(rows);

    return rows.map((b) =>
      this.toApi(b, locationsMap, courtToLocationMap, locationTimeZoneMap),
    );
  }

  async getOne(tenantId: string, bookingId: string, requesterUserId?: string): Promise<BookingApiRow> {
    const row = await this.bookingRepo.findOne({
      where: { id: bookingId, tenantId },
      relations: ['items', 'user'],
    });
    if (!row) throw new NotFoundException(`Booking ${bookingId} not found`);

    if (requesterUserId) {
      const constraint = await this.iamService.getLocationAdminConstraint(requesterUserId);
      if (constraint) {
        const padels = await this.padelRepo.find({ where: { businessLocationId: constraint }, select: ['id'] });
        const turfs = await this.turfRepo.find({ where: { branchId: constraint }, select: ['id'] });
        const courtIds = new Set([...padels.map((p) => p.id), ...turfs.map((t) => t.id)]);
        const allowed = row.items?.some((i) => courtIds.has(i.courtId));
        if (!allowed) throw new ForbiddenException('Booking does not belong to your location');
      }
    }

    const { locationsMap, courtToLocationMap, locationTimeZoneMap } =
      await this.resolveLocationMapping(row);

    return this.toApi(row, locationsMap, courtToLocationMap, locationTimeZoneMap);
  }

  private async assertPadelCourtExists(
    tenantId: string,
    courtId: string,
  ): Promise<PadelCourt> {
    const court = await this.padelRepo.findOne({
      where: { id: courtId, tenantId },
    });
    if (!court)
      throw new BadRequestException(
        `Court ${courtId} not found for this tenant`,
      );
    if (court.courtStatus !== 'active' || court.isActive === false) {
      throw new BadRequestException('Selected court is not available');
    }
    return court;
  }

  private async assertTurfCourtExists(
    tenantId: string,
    courtId: string,
  ): Promise<TurfCourt> {
    const turf = await this.turfRepo.findOne({
      where: { id: courtId, tenantId },
    });
    if (!turf)
      throw new BadRequestException(
        `Turf ${courtId} not found for this tenant`,
      );
    if (turf.status !== 'active') {
      throw new BadRequestException('Selected turf is not available');
    }
    return turf;
  }

  private async assertTableTennisCourtExists(
    tenantId: string,
    courtId: string,
  ): Promise<TableTennisCourt> {
    const court = await this.tableTennisRepo.findOne({
      where: { id: courtId, tenantId },
    });
    if (!court)
      throw new BadRequestException(
        `Table tennis table ${courtId} not found for this tenant`,
      );
    if (court.courtStatus !== 'active' || court.isActive === false) {
      throw new BadRequestException('Selected table is not available');
    }
    return court;
  }

  private inferStepMinutesFromSlots(
    slots: Array<{ startTime: string }>,
  ): number | null {
    const minutes = slots
      .map((s) => toMinutes(s.startTime, false))
      .sort((a, b) => a - b);
    let minDiff: number | null = null;
    for (let i = 1; i < minutes.length; i += 1) {
      const diff = minutes[i] - minutes[i - 1];
      if (diff > 0 && (minDiff === null || diff < minDiff)) {
        minDiff = diff;
      }
    }
    return minDiff;
  }

  private async resolveCourtSlotStepMinutes(
    tenantId: string,
    kind: CourtKind,
    courtId: string,
  ): Promise<number> {
    if (kind === 'padel_court') {
      const row = await this.padelRepo.findOne({
        where: { tenantId, id: courtId },
        select: ['slotDurationMinutes'],
      });
      if (row?.slotDurationMinutes && row.slotDurationMinutes > 0) {
        return row.slotDurationMinutes;
      }
    } else if (kind === 'table_tennis_court') {
      const row = await this.tableTennisRepo.findOne({
        where: { tenantId, id: courtId },
        select: ['slotDurationMinutes'],
      });
      if (row?.slotDurationMinutes && row.slotDurationMinutes > 0) {
        return row.slotDurationMinutes;
      }
    } else if (kind === 'turf_court') {
      const row = await this.turfRepo.findOne({
        where: { tenantId, id: courtId },
        select: ['slotDuration'],
      });
      if (row?.slotDuration && row.slotDuration > 0) {
        return row.slotDuration;
      }
    }
    return BookingsService.DEFAULT_SLOT_STEP_MINUTES;
  }

  private toSlotDateTimes(
    bookingDate: string,
    startTime: string,
    endTime: string,
  ) {
    const date = formatDateOnly(bookingDate);
    const overnight = toMinutes(endTime) <= toMinutes(startTime);
    return {
      startDatetime: new Date(`${date}T${startTime}:00Z`),
      endDatetime: new Date(
        `${overnight ? addDays(date, 1) : date}T${endTime}:00Z`,
      ),
    };
  }

  private isOverlapBeyondGrace(
    existingStart: Date,
    existingEnd: Date,
    requestedStart: Date,
    requestedEnd: Date,
  ): boolean {
    const overlapStartMs = Math.max(
      existingStart.getTime(),
      requestedStart.getTime(),
    );
    const overlapEndMs = Math.min(existingEnd.getTime(), requestedEnd.getTime());
    if (overlapEndMs <= overlapStartMs) return false;

    const overlapMinutes = (overlapEndMs - overlapStartMs) / 60000;
    if (overlapMinutes > BookingsService.SLOT_OVERLAP_GRACE_MINUTES) {
      return true;
    }

    const touchesRequestedStart =
      existingStart.getTime() < requestedStart.getTime() &&
      existingEnd.getTime() > requestedStart.getTime();
    const touchesRequestedEnd =
      existingStart.getTime() < requestedEnd.getTime() &&
      existingEnd.getTime() > requestedEnd.getTime();
    return !(touchesRequestedStart || touchesRequestedEnd);
  }

  /** Same-night chronological order before expanding/splitting (aligns with web app overnight sorting). */
  private sortInboundBookingItemsForCreate(
    bookingDate: string | undefined,
    items: CreateBookingItemDto[],
  ): CreateBookingItemDto[] {
    if (!items.length) return [...items];

    const baseFallback = bookingDate ? formatDateOnly(bookingDate) : '';
    type Row = {
      item: CreateBookingItemDto;
      dateKey: string;
      rawStart: number;
      sortKey: number;
      idx: number;
    };

    const rows: Row[] = items.map((item, idx) => {
      const dk =
        formatDateOnly(item.date ?? item.bookingDate ?? baseFallback ?? '') ||
        '__nodate__';
      const rawStart = toMinutes(item.startTime, false);
      return {
        item,
        dateKey: dk,
        rawStart,
        sortKey: rawStart,
        idx,
      };
    });

    const byDate = new Map<string, Row[]>();
    for (const row of rows) {
      const bucket = byDate.get(row.dateKey);
      if (bucket) bucket.push(row);
      else byDate.set(row.dateKey, [row]);
    }

    for (const group of byDate.values()) {
      if (group.length < 2) continue;
      const mins = group.map((g) => g.rawStart);
      const minS = Math.min(...mins);
      const maxS = Math.max(...mins);
      if (maxS - minS <= 12 * 60) continue;
      for (const g of group) {
        if (g.rawStart < 6 * 60) g.sortKey = g.rawStart + 24 * 60;
      }
    }

    rows.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      const endDiff = toMinutes(a.item.endTime, true) - toMinutes(b.item.endTime, true);
      if (endDiff !== 0) return endDiff;
      if (a.item.courtKind !== b.item.courtKind) {
        return a.item.courtKind.localeCompare(b.item.courtKind);
      }
      return a.item.courtId.localeCompare(b.item.courtId) || a.idx - b.idx;
    });

    return rows.map((r) => r.item);
  }

  private resolveItemBookingDates(
    bookingDate: string,
    items: CreateBookingItemDto[],
  ): string[] {
    const baseDate = formatDateOnly(bookingDate);
    const dayOffsetByCourt = new Map<string, number>();
    const prevEffectiveByCourt = new Map<string, number>();

    const startsByCourt = new Map<string, number[]>();
    for (const item of items) {
      const key = `${item.courtKind}:${item.courtId}`;
      const raw = toMinutes(item.startTime, false);
      const list = startsByCourt.get(key);
      if (list) list.push(raw);
      else startsByCourt.set(key, [raw]);
    }

    const toEffectiveStart = (courtKey: string, rawStart: number): number => {
      const list = startsByCourt.get(courtKey) ?? [rawStart];
      if (list.length < 2) return rawStart;
      const minS = Math.min(...list);
      const maxS = Math.max(...list);
      if (maxS - minS > 12 * 60 && rawStart < 6 * 60) {
        return rawStart + 24 * 60;
      }
      return rawStart;
    };

    return items.map((item) => {
      const key = `${item.courtKind}:${item.courtId}`;
      const raw = toMinutes(item.startTime, false);
      const effective = toEffectiveStart(key, raw);
      const prevEffective = prevEffectiveByCourt.get(key);
      let offset = dayOffsetByCourt.get(key) ?? 0;

      // Effective timeline went backwards ⇒ next calendar day for this court.
      if (prevEffective !== undefined && effective < prevEffective) {
        offset += 1;
        dayOffsetByCourt.set(key, offset);
      } else if (!dayOffsetByCourt.has(key)) {
        dayOffsetByCourt.set(key, offset);
      }

      prevEffectiveByCourt.set(key, effective);
      return addDays(baseDate, offset);
    });
  }

  private expandBookingItems(
    bookingDate: string | undefined,
    items: CreateBookingItemDto[],
  ): Array<CreateBookingItemDto & { date: string }> {
    const derivedDates = bookingDate
      ? this.resolveItemBookingDates(bookingDate, items)
      : [];
    const expanded: Array<CreateBookingItemDto & { date: string }> = [];

    for (const [idx, item] of items.entries()) {
      const fallbackDate = derivedDates[idx];
      const resolvedDate = item.date ?? fallbackDate;
      if (!resolvedDate) {
        throw new BadRequestException(
          'bookingDate is required at root or per item (items[].date/items[].bookingDate)',
        );
      }
      const itemDate = formatDateOnly(resolvedDate);
      const isOvernight = toMinutes(item.endTime, true) <= toMinutes(item.startTime, false);

      if (!isOvernight) {
        expanded.push({ ...item, date: itemDate });
        continue;
      }

      const firstEnd = '24:00';
      const secondDate = addDays(itemDate, 1);
      const secondStart = '00:00';
      const totalMinutes = diffMinutes(item.startTime, item.endTime);
      const firstMinutes = diffMinutes(item.startTime, firstEnd);
      const secondMinutes = diffMinutes(secondStart, item.endTime);
      const firstPrice = Number(((item.price * firstMinutes) / totalMinutes).toFixed(2));
      const secondPrice = Number((item.price - firstPrice).toFixed(2));

      expanded.push({
        ...item,
        date: itemDate,
        endTime: firstEnd,
        price: firstPrice,
      });
      expanded.push({
        ...item,
        date: secondDate,
        startTime: secondStart,
        price: secondPrice,
      });
    }

    return expanded;
  }

  private applyImmediateStartShift(
    items: Array<CreateBookingItemDto & { date: string }>,
  ): Array<CreateBookingItemDto & { date: string }> {
    const today = getCurrentDateInKarachi();
    const nowMinutes = getCurrentMinutesInKarachi();

    return items.map((item) => {
      if (formatDateOnly(item.date) !== today) return item;

      const startMinutes = toMinutes(item.startTime, false);
      const endMinutes = toMinutes(item.endTime, true);
      if (nowMinutes <= startMinutes || nowMinutes >= endMinutes) {
        return item;
      }

      const durationMinutes = diffMinutes(item.startTime, item.endTime);
      const shiftedStart = new Date(`${item.date}T00:00:00Z`);
      shiftedStart.setUTCMinutes(nowMinutes);
      const shiftedEnd = new Date(
        shiftedStart.getTime() + durationMinutes * 60 * 1000,
      );

      return {
        ...item,
        date: formatDateOnly(shiftedStart),
        startTime: shiftedStart.toISOString().slice(11, 16),
        endTime: shiftedEnd.toISOString().slice(11, 16),
      };
    });
  }

  private assertBookingItem(item: CreateBookingItemDto): void {
    if (
      item.courtKind !== 'padel_court' &&
      item.courtKind !== 'turf_court' &&
      item.courtKind !== 'table_tennis_court'
    ) {
      throw new BadRequestException(
        'Only padel_court, turf_court, and table_tennis_court are supported',
      );
    }
    if (item.startTime === '24:00') {
      throw new BadRequestException('startTime cannot be 24:00');
    }
    if (toMinutes(item.endTime) === toMinutes(item.startTime)) {
      throw new BadRequestException('endTime must be different from startTime');
    }
  }

  private async assertNoOverlap(
    tenantId: string,
    date: string,
    item: CreateBookingItemDto,
  ) {
    const { startDatetime, endDatetime } = this.toSlotDateTimes(
      date,
      item.startTime,
      item.endTime,
    );

    const overlaps = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.items', 'i')
      .where('i.courtKind = :kind', { kind: item.courtKind })
      .andWhere('i.courtId = :courtId', { courtId: item.courtId })
      .andWhere("i.itemStatus <> 'cancelled'")
      // Ignore terminal bookings that should not block new reservations.
      .andWhere("b.bookingStatus NOT IN ('cancelled', 'no_show', 'completed')")
      .andWhere('i.startDatetime < :endDatetime', {
        endDatetime: endDatetime.toISOString(),
      })
      .andWhere('i.endDatetime > :startDatetime', {
        startDatetime: startDatetime.toISOString(),
      })
      .select(['i.startDatetime AS startDatetime', 'i.endDatetime AS endDatetime'])
      .getRawMany<{ startDatetime: string; endDatetime: string }>();

    const hasHardOverlap = overlaps.some((row) =>
      this.isOverlapBeyondGrace(
        new Date(row.startDatetime),
        new Date(row.endDatetime),
        startDatetime,
        endDatetime,
      ),
    );

    if (hasHardOverlap)
      throw new ConflictException({
        bookingDate: date,
        startTime: item.startTime,
        endTime: item.endTime,
        courtId: item.courtId,
        reason: 'Selected slot is already booked',
      });
  }

  private async assertNoOtherLiveBookingOnFields(
    tenantId: string,
    items: Array<{
      courtKind: CreateBookingItemDto['courtKind'];
      courtId: string;
      itemStatus?: BookingItemStatus;
    }>,
    excludeBookingId?: string,
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const uniqueFields = new Map<string, { courtKind: string; courtId: string }>();
    for (const item of items) {
      if (item.itemStatus === 'cancelled') continue;
      const key = `${item.courtKind}:${item.courtId}`;
      if (!uniqueFields.has(key)) {
        uniqueFields.set(key, {
          courtKind: item.courtKind,
          courtId: item.courtId,
        });
      }
    }

    for (const field of uniqueFields.values()) {
      const qb = this.bookingRepo
        .createQueryBuilder('b')
        .innerJoin('b.items', 'i')
        .where('b.tenantId = :tenantId', { tenantId })
        .andWhere("b.bookingStatus = 'live'")
        .andWhere("i.itemStatus <> 'cancelled'")
        // Guard against stale "live" rows: only block if currently live in time.
        .andWhere('i.startDatetime <= :nowIso', { nowIso })
        .andWhere('i.endDatetime > :nowIso', { nowIso })
        .andWhere('i.courtKind = :courtKind', { courtKind: field.courtKind })
        .andWhere('i.courtId = :courtId', { courtId: field.courtId });
      if (excludeBookingId) {
        qb.andWhere('b.id <> :excludeBookingId', { excludeBookingId });
      }
      const liveCount = await qb.getCount();
      if (liveCount > 0) {
        throw new ConflictException(
          'Field is already live. End the current live booking before starting another one.',
        );
      }
    }
  }

  async create(
    tenantId: string,
    dto: CreateBookingDto,
  ): Promise<BookingApiRow> {
    if (dto.bookingDate) {
      this.assertBookingDateInAllowedWindow(dto.bookingDate);
    }

    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) throw new BadRequestException(`User ${dto.userId} not found`);

    if (dto.items?.length) {
      dto.items = this.sortInboundBookingItemsForCreate(dto.bookingDate, dto.items);
    }

    let expandedItems = this.expandBookingItems(
      dto.bookingDate,
      dto.items,
    );
    expandedItems = this.applyImmediateStartShift(expandedItems);
    for (const item of expandedItems) {
      this.assertBookingDateInAllowedWindow(item.date);
    }

    for (const item of expandedItems) {
      this.assertBookingItem(item);
      if (item.courtKind === 'padel_court') {
        await this.assertPadelCourtExists(tenantId, item.courtId);
        if (dto.sportType !== 'padel') {
          throw new BadRequestException('padel_court requires sportType=padel');
        }
      }
      if (item.courtKind === 'turf_court') {
        const turf = await this.assertTurfCourtExists(tenantId, item.courtId);
        if (dto.sportType !== 'futsal' && dto.sportType !== 'cricket') {
          throw new BadRequestException(
            'turf_court requires sportType=futsal or sportType=cricket',
          );
        }
        if (!turf.supportedSports.includes(dto.sportType)) {
          throw new BadRequestException(
            `Selected turf does not support ${dto.sportType}`,
          );
        }
      }
      if (item.courtKind === 'table_tennis_court') {
        await this.assertTableTennisCourtExists(tenantId, item.courtId);
        if (dto.sportType !== 'table-tennis') {
          throw new BadRequestException(
            'table_tennis_court requires sportType=table-tennis',
          );
        }
      }
      await this.assertNoOverlap(tenantId, item.date, item);
    }

    const itemsPayload: DeepPartial<BookingItem>[] = expandedItems.map((i) => ({
      courtKind: i.courtKind,
      courtId: i.courtId,
      slotId: i.slotId,
      date: i.date,
      startTime: i.startTime,
      endTime: i.endTime,
      ...this.toSlotDateTimes(i.date, i.startTime, i.endTime),
      price: dec(i.price),
      currency: i.currency ?? 'PKR',
      itemStatus: i.status ?? 'confirmed',
    }));
    itemsPayload.sort(
      (a, b) =>
        ((a.startDatetime as Date)?.getTime() ?? 0) -
        ((b.startDatetime as Date)?.getTime() ?? 0),
    );

    const pricingSubTotal = Number(dto.pricing.subTotal ?? 0);
    const pricingDiscount = Number(dto.pricing.discount ?? 0);
    const pricingTax = Number(dto.pricing.tax ?? 0);
    const payableAmount = this.computePayableAmount(
      pricingSubTotal,
      pricingDiscount,
      pricingTax,
    );
    const paidAmount = Number(dto.payment.paidAmount ?? 0);
    this.assertPaidAmountWithinPayable(paidAmount, payableAmount);

    const bookingPayload: DeepPartial<Booking> = {
      tenantId,
      userId: dto.userId,
      sportType: dto.sportType,
      bookingDate: formatDateOnly(dto.bookingDate ?? expandedItems[0].date),
      subTotal: dec(pricingSubTotal),
      discount: dec(pricingDiscount),
      tax: dec(pricingTax),
      totalAmount: dec(payableAmount),
      paymentStatus: dto.payment.paymentStatus,
      paymentMethod: dto.payment.paymentMethod,
      transactionId: dto.payment.transactionId,
      paidAt: dto.payment.paidAt ? new Date(dto.payment.paidAt) : undefined,
      paidAmount: dec(paidAmount),
      bookingStatus: dto.bookingStatus ?? 'confirmed',
      notes: dto.notes,
      items: itemsPayload,
    };
    harmonizePaymentStatusWithAmounts(
      bookingPayload as Pick<Booking, 'totalAmount' | 'paidAmount' | 'paymentStatus'>,
    );
    const booking = this.bookingRepo.create(bookingPayload);

    let saved: Booking;
    try {
      saved = await this.bookingRepo.save(booking);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as any).driverError?.code === '23505' &&
        String((error as any).driverError?.constraint || '').includes(
          'uq_booking_items_court_start_datetime_active',
        )
      ) {
        throw new ConflictException({
          reason:
            'Selected slot overlaps with an active booking. Please choose another time.',
        });
      }
      throw error;
    }

    const full = await this.bookingRepo.findOneOrFail({
      where: { id: saved.id },
      relations: ['items', 'user'],
    });

    // Block the slots in the facility slots table
    await this.syncFacilitySlotsStatus(full);

    const { locationsMap, courtToLocationMap, locationTimeZoneMap } =
      await this.resolveLocationMapping(full);
    return this.toApi(full, locationsMap, courtToLocationMap, locationTimeZoneMap);
  }

  async update(
    tenantId: string,
    bookingId: string,
    dto: UpdateBookingDto,
  ): Promise<BookingApiRow> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, tenantId },
      relations: ['items', 'user'],
    });
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);

    if (dto.bookingStatus !== undefined) {
      const requestedStatus = dto.bookingStatus;
      if (requestedStatus === 'live') {
        if (booking.bookingStatus === 'live') {
          throw new ConflictException('Booking is already live.');
        }
        const previousItems = booking.items
          .filter((item) => item.itemStatus !== 'cancelled')
          .map((item) => {
            const fallbackDate = formatDateOnly(item.date ?? booking.bookingDate);
            const itemWindow = this.toSlotDateTimes(
              fallbackDate,
              item.startTime,
              item.endTime,
            );
            return Object.assign(new BookingItem(), {
              courtKind: item.courtKind,
              courtId: item.courtId,
              date: fallbackDate,
              startTime: item.startTime,
              endTime: item.endTime,
              startDatetime: item.startDatetime ?? itemWindow.startDatetime,
              endDatetime: item.endDatetime ?? itemWindow.endDatetime,
            });
          });

        await this.setFacilitySlotsStatusForItems({
          tenantId,
          items: previousItems,
          targetStatus: 'available',
          excludeBookingId: booking.id,
        });

        await this.assertNoOtherLiveBookingOnFields(
          tenantId,
          booking.items.map((item) => ({
            courtKind: item.courtKind,
            courtId: item.courtId,
            itemStatus: item.itemStatus,
          })),
          booking.id,
        );
        this.applyLiveWindowToBooking(booking);
      } else {
        booking.bookingStatus = requestedStatus;
      }
      // Align every item in memory: subsequent save() cascades to booking_items, and
      // a raw SQL UPDATE would be overwritten by those stale in-memory item rows.
      let targetItemStatus: BookingItemStatus = 'confirmed';
      if (requestedStatus === 'cancelled' || requestedStatus === 'no_show') {
        targetItemStatus = 'cancelled';
      } else if (requestedStatus === 'pending') {
        targetItemStatus = 'reserved';
      }
      for (const item of booking.items) {
        item.itemStatus = targetItemStatus;
      }
    }
    if (dto.notes !== undefined) booking.notes = dto.notes;
    if (dto.cancellationReason !== undefined)
      booking.cancellationReason = dto.cancellationReason;
    if (dto.pricing) {
      if (dto.pricing.subTotal !== undefined) {
        booking.subTotal = dec(dto.pricing.subTotal);
      }
      if (dto.pricing.discount !== undefined) {
        booking.discount = dec(dto.pricing.discount);
      }
      if (dto.pricing.tax !== undefined) {
        booking.tax = dec(dto.pricing.tax);
      }
      booking.totalAmount = dec(
        this.computePayableAmount(
          numFromDec(booking.subTotal),
          numFromDec(booking.discount),
          numFromDec(booking.tax),
        ),
      );
    }
    if (dto.payment?.paymentStatus !== undefined)
      booking.paymentStatus = dto.payment.paymentStatus;
    if (dto.payment?.paymentMethod !== undefined)
      booking.paymentMethod = dto.payment.paymentMethod;
    if (dto.payment?.transactionId !== undefined)
      booking.transactionId = dto.payment.transactionId;
    if (dto.payment?.paidAt !== undefined) {
      booking.paidAt = dto.payment.paidAt
        ? new Date(dto.payment.paidAt)
        : undefined;
    }
    if (dto.payment?.paidAmount !== undefined) {
      booking.paidAmount = dec(dto.payment.paidAmount);
    }
    this.assertPaidAmountWithinPayable(
      numFromDec(booking.paidAmount),
      numFromDec(booking.totalAmount),
    );
    harmonizePaymentStatusWithAmounts(booking);
    if (dto.itemStatuses?.length) {
      const byId = new Map(booking.items.map((i) => [i.id, i]));
      for (const row of dto.itemStatuses) {
        const item = byId.get(row.itemId);
        if (!item)
          throw new BadRequestException(
            `Item ${row.itemId} not in this booking`,
          );
        item.itemStatus = row.status;
      }
    }
    const saved = await this.bookingRepo.save(booking);

    const full = await this.bookingRepo.findOneOrFail({
      where: { id: saved.id },
      relations: ['items', 'user'],
    });

    await this.syncFacilitySlotsStatus(full);

    const { locationsMap, courtToLocationMap, locationTimeZoneMap } =
      await this.resolveLocationMapping(full);
    return this.toApi(full, locationsMap, courtToLocationMap, locationTimeZoneMap, {
      // PATCH should echo persisted status; "live" is a read-time projection only.
      projectLiveViewStatus: false,
    });
  }

  private applyLiveWindowToBooking(booking: Booking): void {
    const startMinutes = getCurrentMinutesInKarachi();
    const liveDate = getCurrentDateInKarachi();
    booking.bookingStatus = 'live';
    booking.bookingDate = liveDate;
    const activeItems = (booking.items ?? []).filter(
      (item) => item.itemStatus !== 'cancelled',
    );
    if (!activeItems.length) return;

    const normalizedItems = activeItems.map((item) => {
      const fallbackDate = formatDateOnly(item.date ?? booking.bookingDate);
      const originalWindow = this.toSlotDateTimes(
        fallbackDate,
        item.startTime,
        item.endTime,
      );
      return {
        item,
        originalStart: item.startDatetime ?? originalWindow.startDatetime,
        originalEnd: item.endDatetime ?? originalWindow.endDatetime,
      };
    });
    const firstStartMs = Math.min(
      ...normalizedItems.map(({ originalStart }) => originalStart.getTime()),
    );
    const liveBase = new Date(`${liveDate}T00:00:00Z`);
    liveBase.setUTCMinutes(startMinutes);
    const liveBaseMs = liveBase.getTime();
    const slotMinutes = Math.max(
      1,
      Math.min(
        ...normalizedItems.map(({ originalStart, originalEnd }) =>
          Math.max(
            1,
            Math.round((originalEnd.getTime() - originalStart.getTime()) / 60000),
          ),
        ),
      ),
    );

    for (const row of normalizedItems) {
      const durationMinutesRaw = Math.max(
        1,
        Math.round((row.originalEnd.getTime() - row.originalStart.getTime()) / 60000),
      );
      const offsetMinutesRaw = Math.max(
        0,
        Math.round((row.originalStart.getTime() - firstStartMs) / 60000),
      );
      const durationMinutes =
        Math.max(1, Math.round(durationMinutesRaw / slotMinutes)) * slotMinutes;
      const offsetMinutes =
        Math.max(0, Math.round(offsetMinutesRaw / slotMinutes)) * slotMinutes;
      const liveStartDate = new Date(liveBaseMs + offsetMinutes * 60 * 1000);
      const liveEndDate = new Date(
        liveStartDate.getTime() + durationMinutes * 60 * 1000,
      );
      row.item.date = formatDateOnly(liveStartDate);
      row.item.startTime = liveStartDate.toISOString().slice(11, 16);
      row.item.endTime = liveEndDate.toISOString().slice(11, 16);
      row.item.startDatetime = liveStartDate;
      row.item.endDatetime = liveEndDate;
    }
  }

  async remove(tenantId: string, bookingId: string): Promise<{ ok: true }> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, tenantId },
      relations: ['items'],
    });
    if (!booking) throw new NotFoundException(`Booking ${bookingId} not found`);

    // Force everything to available before deleting
    booking.bookingStatus = 'cancelled';
    await this.bookingRepo.manager.query(
      'UPDATE booking_items SET "itemStatus" = $1 WHERE "bookingId" = $2',
      ['cancelled', booking.id],
    );
    await this.syncFacilitySlotsStatus(booking);

    await this.bookingRepo.remove(booking);
    return { ok: true };
  }


  async editBookingFacilitySlots(
    tenantId: string,
    bookingId: string,
    blocked: boolean,
    addOnMinutes?: 30 | 60,
  ): Promise<{ ok: true; bookingId: string; blocked: boolean; extendedBy?: number }> {
    if (!addOnMinutes) {
      return { ok: true, bookingId, blocked };
    }

    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, tenantId },
      relations: ['items'],
    });
    if (!booking) {
      throw new NotFoundException(`Booking ${bookingId} not found`);
    }
    if (!booking.items?.length) {
      throw new BadRequestException('Booking has no items to extend');
    }
    if (booking.bookingStatus === 'cancelled' || booking.bookingStatus === 'no_show') {
      throw new BadRequestException('Only active bookings can be extended');
    }

    const itemsSorted = [...booking.items].sort((a, b) => {
      const aStart = (a.startDatetime ?? this.toSlotDateTimes(formatDateOnly(a.date ?? booking.bookingDate), a.startTime, a.endTime).startDatetime).getTime();
      const bStart = (b.startDatetime ?? this.toSlotDateTimes(formatDateOnly(b.date ?? booking.bookingDate), b.startTime, b.endTime).startDatetime).getTime();
      return aStart - bStart;
    });
    const baseItem = itemsSorted[itemsSorted.length - 1];
    const baseDate = formatDateOnly(baseItem.date ?? booking.bookingDate);
    const baseWindow = this.toSlotDateTimes(baseDate, baseItem.startTime, baseItem.endTime);
    const currentEnd = baseItem.endDatetime ?? baseWindow.endDatetime;

    const checkWindowStart = currentEnd;
    const checkWindowEnd = new Date(currentEnd.getTime() + 60 * 60 * 1000);

    const overlapCount = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.items', 'i')
      .where('b.tenantId = :tenantId', { tenantId })
      .andWhere('b.id <> :bookingId', { bookingId })
      .andWhere("b.bookingStatus IN ('pending', 'confirmed', 'live', 'completed')")
      .andWhere("i.itemStatus <> 'cancelled'")
      .andWhere('i.courtKind = :courtKind', { courtKind: baseItem.courtKind })
      .andWhere('i.courtId = :courtId', { courtId: baseItem.courtId })
      .andWhere('i.startDatetime < :checkWindowEnd', {
        checkWindowEnd: checkWindowEnd.toISOString(),
      })
      .andWhere('i.endDatetime > :checkWindowStart', {
        checkWindowStart: checkWindowStart.toISOString(),
      })
      .getCount();

    if (overlapCount > 0) {
      throw new ConflictException('Upcoming slot is not empty for extension');
    }

    const extensionStart = currentEnd;
    const extensionEnd = new Date(currentEnd.getTime() + addOnMinutes * 60 * 1000);
    const extensionStartTime = extensionStart.toISOString().slice(11, 16);
    const extensionEndTime = extensionEnd.toISOString().slice(11, 16);
    const extensionDate = formatDateOnly(extensionStart);

    const baseDurationMinutes = Math.max(
      1,
      Math.round((baseWindow.endDatetime.getTime() - baseWindow.startDatetime.getTime()) / 60000),
    );
    const basePrice = numFromDec(baseItem.price);
    const perMinutePrice = basePrice / baseDurationMinutes;
    const extensionPrice = Number((perMinutePrice * addOnMinutes).toFixed(2));

    const extraItem = this.bookingRepo.manager
      .getRepository(BookingItem)
      .create({
        bookingId: booking.id,
        courtKind: baseItem.courtKind,
        courtId: baseItem.courtId,
        slotId: undefined,
        date: extensionDate,
        startTime: extensionStartTime,
        endTime: extensionEndTime,
        startDatetime: extensionStart,
        endDatetime: extensionEnd,
        price: dec(extensionPrice),
        currency: baseItem.currency || 'PKR',
        itemStatus: baseItem.itemStatus === 'cancelled' ? 'confirmed' : baseItem.itemStatus,
      });
    await this.bookingRepo.manager.getRepository(BookingItem).save(extraItem);

    booking.subTotal = dec(numFromDec(booking.subTotal) + extensionPrice);
    booking.totalAmount = dec(
      numFromDec(booking.subTotal) - numFromDec(booking.discount) + numFromDec(booking.tax),
    );
    harmonizePaymentStatusWithAmounts(booking);
    await this.bookingRepo.save(booking);

    const full = await this.bookingRepo.findOneOrFail({
      where: { id: bookingId, tenantId },
      relations: ['items'],
    });
    await this.syncFacilitySlotsStatus(full);

    return { ok: true, bookingId, blocked, extendedBy: addOnMinutes };
  }

  async getAvailabilityByTime(
    tenantId: string,
    params: {
      date: string;
      startTime: string;
      endTime: string;
      sportType?: BookingSportType;
    },
  ) {
    const date = formatDateOnly(params.date);
    const nextDate = addDays(date, 1);
    const sport = params.sportType ?? 'padel';
    const isTurf = sport === 'futsal' || sport === 'cricket';
    const isTableTennis = sport === 'table-tennis';

    // --- Fetch the right courts based on sportType ---
    type CourtRow = {
      id: string;
      name: string;
      pricePerSlot: string | null;
      slotDurationMinutes: number | null;
      courtKind: 'padel_court' | 'turf_court' | 'table_tennis_court';
    };

    let allCourts: CourtRow[];
    if (isTurf) {
      const turfRows = await this.turfRepo.find({
        where: { tenantId, status: 'active' },
        select: ['id', 'name', 'slotDuration', 'pricing', 'supportedSports'],
      });
      allCourts = turfRows
        .filter((t) => t.supportedSports?.includes(sport))
        .map((t) => ({
          id: t.id,
          name: t.name,
          pricePerSlot: (t.pricing?.[sport as 'futsal' | 'cricket']?.basePrice) != null
              ? String(t.pricing[sport as 'futsal' | 'cricket']!.basePrice)
              : null,
          slotDurationMinutes: t.slotDuration ?? null,
          courtKind: 'turf_court' as const,
        }));
    } else if (isTableTennis) {
      const rows = await this.tableTennisRepo.find({
        where: { tenantId, isActive: true, courtStatus: 'active' },
        select: ['id', 'name', 'pricePerSlot', 'slotDurationMinutes'],
      });
      allCourts = rows.map((c) => ({
        id: c.id,
        name: c.name,
        pricePerSlot: c.pricePerSlot ?? null,
        slotDurationMinutes: c.slotDurationMinutes ?? null,
        courtKind: 'table_tennis_court' as const,
      }));
    } else {
      const padelRows = await this.padelRepo.find({
        where: { tenantId, isActive: true, courtStatus: 'active' },
        select: ['id', 'name', 'pricePerSlot', 'slotDurationMinutes'],
      });
      allCourts = padelRows.map((c) => ({
        id: c.id,
        name: c.name,
        pricePerSlot: c.pricePerSlot ?? null,
        slotDurationMinutes: c.slotDurationMinutes ?? null,
        courtKind: 'padel_court' as const,
      }));
    }

    // --- Find booked slots that overlap the requested window ---
    const courtKindFilter: CourtKind = isTurf
      ? 'turf_court'
      : isTableTennis
        ? 'table_tennis_court'
        : 'padel_court';
    const queryStart = new Date(`${date}T00:00:00.000Z`);
    queryStart.setUTCMinutes(toMinutes(params.startTime, false));
    const queryEnd = new Date(`${date}T00:00:00.000Z`);
    queryEnd.setUTCMinutes(toMinutes(params.endTime, true));
    if (queryEnd <= queryStart) queryEnd.setUTCDate(queryEnd.getUTCDate() + 1);

    const busy = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.items', 'i')
      .where('b.tenantId = :tenantId', { tenantId })
      .andWhere("b.bookingStatus IN ('confirmed', 'pending', 'live')")
      .andWhere("i.itemStatus IN ('confirmed', 'reserved')")
      .andWhere('i.courtKind = :courtKind', { courtKind: courtKindFilter })
      .andWhere('i.startDatetime < :queryEnd', {
        queryEnd: queryEnd.toISOString(),
      })
      .andWhere('i.endDatetime > :queryStart', {
        queryStart: queryStart.toISOString(),
      })
      .select([
        'i.courtId AS courtId',
        'i.courtKind AS courtKind',
        'i.startTime AS startTime',
        'i.endTime AS endTime',
        'b.id AS bookingId',
        'i.id AS id',
        'i.itemStatus AS itemStatus',
      ])
      .getRawMany<{
        courtId: string;
        courtKind: string;
        startTime: string;
        endTime: string;
        bookingId: string;
        id: string;
        itemStatus: BookingItemStatus;
      }>();

    const busyIds = new Set(busy.map((x) => x.courtId));

    // --- Also check for slots explicitly marked as "blocked" (e.g. via templates) ---
    const blocked = await this.facilitySlotRepo.find({
      where: [
        {
          tenantId,
          courtKind: courtKindFilter,
          slotDate: date,
          status: 'blocked',
        },
        {
          tenantId,
          courtKind: courtKindFilter,
          slotDate: nextDate,
          status: 'blocked',
        },
      ],
      select: ['courtId', 'slotDate', 'startTime', 'endTime'],
    });

    const blockedIds = new Set<string>();
    for (const fs of blocked) {
      if (
        new Date(`${fs.slotDate}T${fs.startTime}:00Z`) < queryEnd &&
        new Date(`${fs.slotDate}T${fs.endTime}:00Z`) > queryStart
      ) {
        blockedIds.add(fs.courtId);
      }
    }
    return {
      date,
      startTime: params.startTime,
      endTime: params.endTime,
      sportType: sport,
      availableCourts: allCourts
        .filter((c) => !busyIds.has(c.id) && !blockedIds.has(c.id))
        .map((c) => ({
          kind: c.courtKind,
          id: c.id,
          name: c.name,
          pricePerSlot: c.pricePerSlot ? Number(c.pricePerSlot) : null,
          slotDurationMinutes: c.slotDurationMinutes ?? null,
        })),
      bookedSlots: busy.map((x) => ({
        kind: x.courtKind,
        courtId: x.courtId,
        startTime: x.startTime,
        endTime: x.endTime,
        bookingId: x.bookingId,
        itemId: x.id,
        status: x.itemStatus,
      })),
    };
  }

  async getCourtSlots(
    tenantId: string,
    params: {
      kind: CourtKind;
      courtId: string;
      date: string;
      startTime?: string;
      endTime?: string;
      availableOnly?: boolean;
      skipCourtCheck?: boolean;
    },
  ) {
    if (!params.skipCourtCheck) {
      if (params.kind === 'padel_court') {
        await this.assertPadelCourtExists(tenantId, params.courtId);
      } else if (params.kind === 'turf_court') {
        await this.assertTurfCourtExists(tenantId, params.courtId);
      } else if (params.kind === 'table_tennis_court') {
        await this.assertTableTennisCourtExists(tenantId, params.courtId);
      } else {
        throw new BadRequestException('Unsupported court kind');
      }
    }
    const date = formatDateOnly(params.date);
    const start = toMinutes(params.startTime ?? '00:00', false);
    const end = toMinutes(params.endTime ?? '24:00', true);

    const slotStepMinutes = await this.resolveCourtSlotStepMinutes(
      tenantId,
      params.kind,
      params.courtId,
    );

    // Instead of completely generating grid steps, we will read the real slots from court_facility_slots
    // if they exist for this court and date, falling back to the configured grid loop if nothing exists.
    const facilitySlots = await this.facilitySlotRepo.find({
      where: {
        tenantId,
        courtKind: params.kind,
        courtId: params.courtId,
        slotDate: date,
      },
      order: { startTime: 'ASC' },
    });

    const queryStart = new Date(`${date}T00:00:00.000Z`);
    queryStart.setUTCMinutes(toMinutes(params.startTime ?? '00:00', false));
    const queryEnd = new Date(`${date}T00:00:00.000Z`);
    queryEnd.setUTCMinutes(toMinutes(params.endTime ?? '24:00', true));

    const rows = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.items', 'i')
      .andWhere('b.tenantId = :tenantId', { tenantId })
      .andWhere("b.bookingStatus IN ('confirmed', 'pending', 'live')")
      .andWhere("i.itemStatus <> 'cancelled'")
      .andWhere('i.courtKind = :kind', { kind: params.kind })
      .andWhere('i.courtId = :courtId', { courtId: params.courtId })
      .andWhere('i.startDatetime < :queryEnd', { queryEnd: queryEnd.toISOString() })
      .andWhere('i.endDatetime > :queryStart', {
        queryStart: queryStart.toISOString(),
      })
      .select([
        'b.id AS bookingId',
        'i.id AS id',
        'i.startTime AS startTime',
        'i.endTime AS endTime',
        'i.startDatetime AS startDatetime',
        'i.endDatetime AS endDatetime',
        'i.itemStatus AS itemStatus',
      ])
      .getRawMany<{
        bookingId: string;
        id: string;
        startTime: string;
        endTime: string;
        startDatetime: string;
        endDatetime: string;
        itemStatus: BookingItemStatus;
      }>();

    let slots: Array<any> = [];
    if (facilitySlots.length > 0) {
      for (const fs of facilitySlots) {
        if (toMinutes(fs.startTime, false) >= end || toMinutes(fs.endTime, true) <= start)
          continue;
        const hit = rows.find(
          (r) => {
            const slotWindow = this.toSlotDateTimes(
              date,
              fs.startTime,
              fs.endTime,
            );
            return this.isOverlapBeyondGrace(
              new Date(r.startDatetime),
              new Date(r.endDatetime),
              slotWindow.startDatetime,
              slotWindow.endDatetime,
            );
          },
        );
        if (hit) {
          slots.push({
            startTime: fs.startTime,
            endTime: fs.endTime,
            availability: 'booked',
            bookingId: hit.bookingId,
            itemId: hit.id,
            status: hit.itemStatus,
          });
        } else if (fs.status === 'blocked') {
          slots.push({
            startTime: fs.startTime,
            endTime: fs.endTime,
            availability: 'blocked',
          });
        } else {
          slots.push({
            startTime: fs.startTime,
            endTime: fs.endTime,
            availability: 'available',
          });
        }
      }
    } else {
      // Fallback if no template slots were created
      for (let m = start; m < end; m += slotStepMinutes) {
        const s = minutesToTimeString(m);
        const e = minutesToTimeString(m + slotStepMinutes);
        const hit = rows.find(
          (r) => {
            const slotWindow = this.toSlotDateTimes(date, s, e);
            return this.isOverlapBeyondGrace(
              new Date(r.startDatetime),
              new Date(r.endDatetime),
              slotWindow.startDatetime,
              slotWindow.endDatetime,
            );
          },
        );
        if (hit) {
          slots.push({
            startTime: s,
            endTime: e,
            availability: 'booked',
            bookingId: hit.bookingId,
            itemId: hit.id,
            status: hit.itemStatus,
          });
        } else {
          slots.push({ startTime: s, endTime: e, availability: 'available' });
        }
      }
    }

    if (params.availableOnly) {
      slots = slots.filter((s) => s.availability === 'available');
    }

    // --- Filter out past slots (today and older) ---
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    const hh = parts.find((p) => p.type === 'hour')?.value;
    const mm = parts.find((p) => p.type === 'minute')?.value;

    const todayStr = `${y}-${m}-${d}`;
    const currentTimeStr = `${hh}:${mm}`;
    const currentHour = Number(hh);
    const currentMinute = Number(mm);

    if (date < todayStr) {
      slots = [];
    } else if (date === todayStr) {
      // Keep the current in-progress slot visible; hide only slots that already ended.
      slots = slots.filter((s) => s.endTime > currentTimeStr);

      // Current-hour slots should only be shown in the first 29 minutes.
      if (currentMinute > 29) {
        const currentHourStart = currentHour * 60;
        const nextHourStart = (currentHour + 1) * 60;
        slots = slots.filter((s) => {
          const slotStart = toMinutes(s.startTime, false);
          return slotStart < currentHourStart || slotStart >= nextHourStart;
        });
      }
    }

    return { date, kind: params.kind, courtId: params.courtId, slots };
  }

  async getCourtSlotGrid(
    tenantId: string,
    params: {
      kind: CourtKind;
      courtId: string;
      date: string;
      startTime?: string;
      endTime?: string;
      availableOnly?: boolean;
      skipCourtCheck?: boolean;
    },
  ) {
    const data = await this.getCourtSlots(tenantId, {
      ...params,
      availableOnly: false,
    });
    let segments = data.slots.map((s: any) =>
      s.availability === 'booked'
        ? {
            startTime: s.startTime,
            endTime: s.endTime,
            state: 'booked',
            bookingId: s.bookingId,
            itemId: s.itemId,
            status: s.status,
          }
        : s.availability === 'blocked'
          ? { startTime: s.startTime, endTime: s.endTime, state: 'blocked' }
          : { startTime: s.startTime, endTime: s.endTime, state: 'free' },
    );

    // segments is already filtered for past slots by getCourtSlots call above.

    if (params.availableOnly) {
      segments = segments.filter((s: any) => s.state === 'free');
    }

    return {
      date: data.date,
      kind: data.kind,
      courtId: data.courtId,
      segmentMinutes:
        this.inferStepMinutesFromSlots(data.slots) ??
        (await this.resolveCourtSlotStepMinutes(
          tenantId,
          params.kind,
          params.courtId,
        )),
      gridStartTime: params.startTime ?? '00:00',
      gridEndTime: params.endTime ?? '24:00',
      availableOnly: params.availableOnly || undefined,
      segments,
    };
  }

  async generateDayFacilitySlots(
    tenantId: string,
    params: { kind: CourtKind; courtId: string; date: string },
  ): Promise<{ ok: true; upserted: number }> {
    let templateId: string | null = null;
    if (params.kind === 'padel_court') {
      const court = await this.assertPadelCourtExists(tenantId, params.courtId);
      templateId = court.timeSlotTemplateId;
    } else if (params.kind === 'turf_court') {
      const court = await this.assertTurfCourtExists(tenantId, params.courtId);
      templateId = court.timeSlotTemplateId;
    } else if (params.kind === 'table_tennis_court') {
      const court = await this.assertTableTennisCourtExists(
        tenantId,
        params.courtId,
      );
      templateId = court.timeSlotTemplateId;
    } else {
      throw new BadRequestException('Unsupported court kind');
    }

    const date = formatDateOnly(params.date);
    const values: Partial<CourtFacilitySlot>[] = [];

    let templateLines: TenantTimeSlotTemplateLine[] = [];
    if (templateId) {
      templateLines = await this.slotTemplateLineRepo.find({
        where: { templateId, tenantId },
      });
    }

    if (templateLines.length > 0) {
      for (const line of templateLines) {
        values.push({
          tenantId,
          courtKind: params.kind,
          courtId: params.courtId,
          slotDate: date,
          startTime: line.startTime,
          endTime: line.endTime,
          status: line.status as any,
        });
      }
    } else {
      const slotStepMinutes = await this.resolveCourtSlotStepMinutes(
        tenantId,
        params.kind,
        params.courtId,
      );
      for (let m = 0; m < 24 * 60; m += slotStepMinutes) {
        values.push({
          tenantId,
          courtKind: params.kind,
          courtId: params.courtId,
          slotDate: date,
          startTime: minutesToTimeString(m),
          endTime: minutesToTimeString(m + slotStepMinutes),
          status: 'available',
        });
      }
    }

    await this.facilitySlotRepo
      .createQueryBuilder()
      .insert()
      .into(CourtFacilitySlot)
      .values(values as CourtFacilitySlot[])
      .orIgnore()
      .execute();

    return { ok: true, upserted: values.length };
  }

  async patchFacilitySlot(
    tenantId: string,
    params: {
      kind: CourtKind;
      courtId: string;
      date: string;
      startTime: string;
      status: 'available' | 'blocked';
    },
  ) {
    if (params.kind === 'padel_court') {
      await this.assertPadelCourtExists(tenantId, params.courtId);
    } else if (params.kind === 'turf_court') {
      await this.assertTurfCourtExists(tenantId, params.courtId);
    } else if (params.kind === 'table_tennis_court') {
      await this.assertTableTennisCourtExists(tenantId, params.courtId);
    } else {
      throw new BadRequestException('Unsupported court kind');
    }
    const slotDate = formatDateOnly(params.date);
    const existing = await this.facilitySlotRepo.findOne({
      where: {
        tenantId,
        courtKind: params.kind,
        courtId: params.courtId,
        slotDate,
        startTime: params.startTime,
      },
      select: ['endTime'],
    });
    const endTime =
      existing?.endTime ??
      minutesToTimeString(
        toMinutes(params.startTime) +
          (await this.resolveCourtSlotStepMinutes(
            tenantId,
            params.kind,
            params.courtId,
          )),
      );
    await this.facilitySlotRepo.upsert(
      {
        tenantId,
        courtKind: params.kind,
        courtId: params.courtId,
        slotDate,
        startTime: params.startTime,
        endTime,
        status: params.status,
      },
      {
        conflictPaths: [
          'tenantId',
          'courtKind',
          'courtId',
          'slotDate',
          'startTime',
        ],
      },
    );
    return { ok: true };
  }

  async setCourtSlotBlock(
    tenantId: string,
    params: {
      kind: CourtKind;
      courtId: string;
      date: string;
      startTime: string;
      blocked: boolean;
    },
  ) {
    if (params.kind === 'padel_court') {
      await this.assertPadelCourtExists(tenantId, params.courtId);
    } else if (params.kind === 'turf_court') {
      await this.assertTurfCourtExists(tenantId, params.courtId);
    } else if (params.kind === 'table_tennis_court') {
      await this.assertTableTennisCourtExists(tenantId, params.courtId);
    } else {
      throw new BadRequestException('Unsupported court kind');
    }
    const where = {
      tenantId,
      courtKind: params.kind,
      courtId: params.courtId,
      blockDate: formatDateOnly(params.date),
      startTime: params.startTime,
    };
    if (params.blocked) {
      const existing = await this.slotBlockRepo.findOne({ where });
      if (!existing)
        await this.slotBlockRepo.save(this.slotBlockRepo.create(where));
    } else {
      await this.slotBlockRepo.delete(where);
    }
    return { ok: true };
  }

  async getLocationFacilitiesAvailableSlots(params: {
    locationId: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    courtType?: string;
    tableTennisPlayType?: string;
  }) {
    const date = params.date
      ? formatDateOnly(params.date)
      : getCurrentDateInKarachi();
    const start = params.startTime ?? '00:00';
    const end = params.endTime ?? '24:00';
    const kinds = this.normalizeKindForAvail(params.courtType);

    const padelBatch = kinds.includes('padel_court')
      ? await this.padelRepo.find({
          where: { businessLocationId: params.locationId, isActive: true, courtStatus: In(['active', 'draft']) as any },
          select: ['id', 'name', 'tenantId', 'pricePerSlot'],
        })
      : [];

    const turfBatch = kinds.includes('turf_court')
      ? await this.turfRepo.find({
          where: { branchId: params.locationId, status: 'active' },
          select: ['id', 'name', 'tenantId', 'pricing', 'supportedSports'],
        })
      : [];

    const tableTennisBatch = kinds.includes('table_tennis_court')
      ? await this.tableTennisRepo.find({
          where: {
            businessLocationId: params.locationId,
            isActive: true,
            courtStatus: In(['active', 'draft']) as any,
          },
          select: ['id', 'name', 'tenantId', 'pricePerSlot', 'meta'],
        })
      : [];

    const buildSlotsResponseForDate = async (targetDate: string) => {
      const facilities: Array<{
        kind: CourtKind;
        courtId: string;
        name: string;
        price?: number;
        slots: Array<{ startTime: string; endTime: string; availability: string }>;
      }> = [];

      const requestedType = (params.courtType || '').toLowerCase();
      const isFutsalRequested = requestedType.includes('futsal');
      const isCricketRequested = requestedType.includes('cricket');

      const [padelFacilities, turfFacilities, tableTennisFacilities] =
        await Promise.all([
          Promise.all(
            padelBatch.map(async (court) => {
              const grid = await this.getCourtSlotGrid(court.tenantId, {
                kind: 'padel_court',
                courtId: court.id,
                date: targetDate,
                startTime: start,
                endTime: end,
                availableOnly: false,
                skipCourtCheck: true,
              });
              return {
                kind: 'padel_court' as const,
                courtId: court.id,
                name: court.name,
                price: Number(court.pricePerSlot || 0),
                slots: grid.segments.map((s: any) => ({
                  startTime: s.startTime,
                  endTime: s.endTime,
                  availability: s.state === 'free' ? 'available' : s.state,
                })),
              };
            }),
          ),
          Promise.all(
            turfBatch
              .filter((court) => {
                if (
                  isFutsalRequested &&
                  !court.supportedSports?.includes('futsal')
                )
                  return false;
                if (
                  isCricketRequested &&
                  !court.supportedSports?.includes('cricket')
                )
                  return false;
                return true;
              })
              .map(async (court) => {
                const grid = await this.getCourtSlotGrid(court.tenantId, {
                  kind: 'turf_court',
                  courtId: court.id,
                  date: targetDate,
                  startTime: start,
                  endTime: end,
                  availableOnly: false,
                  skipCourtCheck: true,
                });
                return {
                  kind: 'turf_court' as const,
                  courtId: court.id,
                  name: court.name,
                  price: this.resolveTurfPrice(court, params.courtType),
                  slots: grid.segments.map((s: any) => ({
                    startTime: s.startTime,
                    endTime: s.endTime,
                    availability: s.state === 'free' ? 'available' : s.state,
                  })),
                };
              }),
          ),
          Promise.all(
            tableTennisBatch.map(async (court) => {
              const grid = await this.getCourtSlotGrid(court.tenantId, {
                kind: 'table_tennis_court',
                courtId: court.id,
                date: targetDate,
                startTime: start,
                endTime: end,
                availableOnly: false,
                skipCourtCheck: true,
              });
              return {
                kind: 'table_tennis_court' as const,
                courtId: court.id,
                name: court.name,
                price: this.resolveTableTennisPrice(
                  court,
                  params.tableTennisPlayType,
                ),
                slots: grid.segments.map((s: any) => ({
                  startTime: s.startTime,
                  endTime: s.endTime,
                  availability: s.state === 'free' ? 'available' : s.state,
                })),
              };
            }),
          ),
        ]);

      facilities.push(...padelFacilities, ...turfFacilities, ...tableTennisFacilities);

      const unionMap = new Map<
        string,
        { startTime: string; endTime: string; availability: string }
      >();
      for (const f of facilities) {
        for (const s of f.slots) {
          const key = `${s.startTime}\t${s.endTime}`;
          const existing = unionMap.get(key);
          if (
            !existing ||
            (existing.availability === 'blocked' &&
              s.availability === 'available')
          ) {
            unionMap.set(key, s as any);
          }
        }
      }

      return {
        date: targetDate,
        facilities,
        unionSlots: [...unionMap.values()].sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        ),
      };
    };

    const currentDateSlots = await buildSlotsResponseForDate(date);
    const additionalDates = await Promise.all(
      Array.from(
        { length: BookingsService.MAX_BOOKING_DAYS_AHEAD },
        (_, idx) => buildSlotsResponseForDate(addDays(date, idx + 1)),
      ),
    );
    const nextDateSlots = additionalDates[0] ?? null;
    const unionSlotsAll = [currentDateSlots, ...additionalDates].flatMap((day) =>
      day.unionSlots.map((slot) => ({
        date: day.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        availability: slot.availability,
      })),
    );

    return {
      date,
      locationId: params.locationId,
      courtType: params.courtType ?? 'all',
      facilities: currentDateSlots.facilities,
      unionSlots: currentDateSlots.unionSlots,
      unionSlotsAll,
      nextDateSlots,
      additionalDates,
    };
  }

  private mapPadelToLiveDto(c: PadelCourt): LivePadelCourtDto {
    return {
      id: c.id,
      tenantId: c.tenantId,
      businessLocationId: c.businessLocationId ?? null,
      name: c.name,
      arenaLabel: c.arenaLabel ?? null,
      courtStatus: c.courtStatus,
      pricePerSlot: Number(c.pricePerSlot || 0),
      imageUrls: c.imageUrls ?? null,
      slotDurationMinutes: c.slotDurationMinutes ?? null,
      timeSlotTemplateId: c.timeSlotTemplateId,
      isActive: c.isActive,
    };
  }

  private mapTableTennisToLiveDto(c: TableTennisCourt): LivePadelCourtDto {
    return {
      id: c.id,
      tenantId: c.tenantId,
      businessLocationId: c.businessLocationId ?? null,
      name: c.name,
      arenaLabel: null,
      courtStatus: c.courtStatus,
      pricePerSlot: Number(c.pricePerSlot || 0),
      imageUrls: c.imageUrls ?? null,
      slotDurationMinutes: c.slotDurationMinutes ?? null,
      timeSlotTemplateId: c.timeSlotTemplateId,
      isActive: c.isActive,
    };
  }

  private mapTurfToLiveDto(t: TurfCourt): LiveTurfCourtDto {
    return {
      id: t.id,
      tenantId: t.tenantId,
      branchId: t.branchId,
      name: t.name,
      status: t.status,
      supportedSports: t.supportedSports ?? [],
      length: t.length ?? null,
      width: t.width ?? null,
      coveredType: t.coveredType,
      surfaceType: t.surfaceType ?? null,
      slotDuration: t.slotDuration,
      bufferTime: t.bufferTime,
      timeSlotTemplateId: t.timeSlotTemplateId,
      pricing: t.pricing,
      sportConfig: t.sportConfig,
    };
  }

  private async assertCanReadLiveFacilities(
    requesterUserId: string,
    tenantId: string | undefined,
    locationId: string,
  ): Promise<BusinessLocation> {
    const isPlatformOwner = await this.iamService.hasAnyRole(
      requesterUserId,
      ['platform-owner'],
    );
    const constraint = await this.iamService.getLocationAdminConstraint(
      requesterUserId,
    );
    if (constraint && constraint !== locationId) {
      throw new ForbiddenException('Not allowed to view this location');
    }
    if (!isPlatformOwner && !tenantId) {
      throw new UnauthorizedException('Tenant ID is required');
    }
    const loc = await this.locationRepo.findOne({
      where: { id: locationId },
      relations: ['business'],
    });
    if (!loc) {
      throw new NotFoundException(`Location ${locationId} not found`);
    }
    if (tenantId && loc.business?.tenantId !== tenantId) {
      throw new ForbiddenException('Location does not belong to this tenant');
    }
    return loc;
  }

  /**
   * One payload for the mobile “Live facilities” page: padel + turf (futsal/cricket) catalog
   * plus the same day slot grid as `getLocationFacilitiesAvailableSlots` (replaces
   * separate `/arena/turf-courts` and `/facilities/available-slots` for that screen).
   */
  async getLocationLiveFacilities(params: {
    requesterUserId: string;
    tenantId?: string;
    locationId: string;
    date: string;
    startTime?: string;
    endTime?: string;
    courtType?: string;
  }): Promise<LocationLiveFacilitiesView> {
    const loc = await this.assertCanReadLiveFacilities(
      params.requesterUserId,
      params.tenantId,
      params.locationId,
    );
    const timeZone = (loc.timezone || '').trim() || 'Asia/Karachi';
    const tenantIdForBookings = loc.business?.tenantId;

    const [slotsPayload, padelRows, turfRows, tableTennisRows] =
      await Promise.all([
        this.getLocationFacilitiesAvailableSlots({
          locationId: params.locationId,
          date: params.date,
          startTime: params.startTime,
          endTime: params.endTime,
          courtType: params.courtType,
        }),
        this.padelRepo.find({
          where: {
            businessLocationId: params.locationId,
            isActive: true,
            courtStatus: In(['active', 'draft']) as any,
          },
          order: { name: 'ASC' },
        }),
        this.turfRepo.find({
          where: { branchId: params.locationId, status: 'active' },
          order: { name: 'ASC' },
        }),
        this.tableTennisRepo.find({
          where: {
            businessLocationId: params.locationId,
            isActive: true,
            courtStatus: In(['active', 'draft']) as any,
          },
          order: { name: 'ASC' },
        }),
      ]);
    const futsal: LiveTurfCourtDto[] = [];
    const cricket: LiveTurfCourtDto[] = [];
    for (const t of turfRows) {
      const d = this.mapTurfToLiveDto(t);
      if (t.supportedSports?.includes('futsal')) futsal.push(d);
      if (t.supportedSports?.includes('cricket')) cricket.push(d);
    }
    const liveSlots = slotsPayload as LiveFacilitiesSlotsPayload;

    const allCourtIds = [
      ...padelRows.map((p) => p.id),
      ...turfRows.map((t) => t.id),
      ...tableTennisRows.map((t) => t.id),
    ];

    let liveBookings: Booking[] = [];
    if (tenantIdForBookings && allCourtIds.length) {
      const ymd = ymdInTimeZone(timeZone);
      const from = addDaysYmd(ymd, -7);
      const to = addDaysYmd(ymd, 90);
      const courtSet = new Set(allCourtIds);
      const rows = await this.bookingRepo.find({
        where: {
          tenantId: tenantIdForBookings,
          bookingDate: Between(from, to),
          bookingStatus: In([
            'pending',
            'confirmed',
            'live',
          ] as BookingStatus[]),
        },
        relations: ['items', 'user'],
      });
      liveBookings = rows.filter((b) =>
        b.items?.some((i) => courtSet.has(i.courtId)),
      );
    }

    const facilityPlayStatus: FacilityPlaySnapshot[] = [];
    for (const c of padelRows) {
      facilityPlayStatus.push(
        buildPlaySnapshot(liveBookings, 'padel_court', c.id, c.name, {
          timeZone,
          facilityActive: Boolean(c.isActive) && c.courtStatus !== 'maintenance',
          statusRaw: c.courtStatus,
        }),
      );
    }
    for (const t of turfRows) {
      facilityPlayStatus.push(
        buildPlaySnapshot(liveBookings, 'turf_court', t.id, t.name, {
          timeZone,
          facilityActive: t.status === 'active',
          statusRaw: t.status,
        }),
      );
    }
    for (const t of tableTennisRows) {
      facilityPlayStatus.push(
        buildPlaySnapshot(
          liveBookings,
          'table_tennis_court',
          t.id,
          t.name,
          {
            timeZone,
            facilityActive: Boolean(t.isActive) && t.courtStatus !== 'maintenance',
            statusRaw: t.courtStatus,
          },
        ),
      );
    }

    return {
      locationId: params.locationId,
      generatedAt: new Date().toISOString(),
      timeZone,
      facilityPlayStatus,
      padelCourts: padelRows.map((c) => this.mapPadelToLiveDto(c)),
      tableTennisCourts: tableTennisRows.map((c) => this.mapTableTennisToLiveDto(c)),
      turfCourts: { futsal, cricket },
      liveSlots,
    };
  }

  private resolveTurfPrice(turf: any, requestedType?: string): number {
    const s = (requestedType || '').toLowerCase();
    const pricing = turf.pricing || {};
    let priceObj: any = null;

    if (s.includes('futsal')) priceObj = pricing.futsal;
    else if (s.includes('cricket')) priceObj = pricing.cricket;

    if (!priceObj) {
      const firstSport = turf.supportedSports?.[0];
      if (firstSport) priceObj = pricing[firstSport];
    }
    return Number(priceObj?.basePrice ?? 0);
  }

  private normalizeTableTennisPlayType(
    raw?: string,
  ): TableTennisPlayType | null {
    const s = (raw || '').trim().toLowerCase();
    if (s === 'singles') return 'singles';
    if (s === 'doubles') return 'doubles';
    return null;
  }

  private resolveTableTennisPrice(
    court: { pricePerSlot?: string | null; meta?: Record<string, unknown> | null },
    playType?: string,
  ): number {
    const meta = (court.meta || {}) as Record<string, unknown>;
    const normalized = this.normalizeTableTennisPlayType(playType);
    const parsePrice = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    if (normalized === 'singles') {
      const p = parsePrice(meta.singlesPricePerSlot ?? meta.singlesPricePerHour);
      if (p !== null) return p;
    }
    if (normalized === 'doubles') {
      const p = parsePrice(meta.doublesPricePerSlot ?? meta.doublesPricePerHour);
      if (p !== null) return p;
    }
    return Number(court.pricePerSlot || 0);
  }

  async getLocationFacilitiesAvailableForSlot(params: {
    locationId: string;
    date: string;
    startTime: string;
    endTime?: string;
    courtType?: string;
    tableTennisPlayType?: string;
  }) {
    const date = formatDateOnly(params.date);
    const nextDate = addDays(date, 1);
    const start = params.startTime ?? '09:00';
    const end =
      params.endTime ??
      minutesToTimeString(
        toMinutes(start, false) + BookingsService.DEFAULT_SLOT_STEP_MINUTES,
      );

    const kinds = this.normalizeKindForAvail(params.courtType);

    const padelBatch = kinds.includes('padel_court')
      ? await this.padelRepo.find({
          where: {
            businessLocationId: params.locationId,
            isActive: true,
            courtStatus: In(['active', 'draft']) as any,
          },
          select: ['id', 'name', 'tenantId', 'pricePerSlot'],
        })
      : [];

    const turfBatch = kinds.includes('turf_court')
      ? await this.turfRepo.find({
          where: { branchId: params.locationId, status: 'active' },
          select: ['id', 'name', 'tenantId', 'pricing', 'supportedSports'],
        })
      : [];

    const tableTennisAvailBatch = kinds.includes('table_tennis_court')
      ? await this.tableTennisRepo.find({
          where: {
            businessLocationId: params.locationId,
            isActive: true,
            courtStatus: In(['active', 'draft']) as any,
          },
          select: ['id', 'name', 'tenantId', 'pricePerSlot', 'meta'],
        })
      : [];

    const allCourts = [
      ...padelBatch.map((c) => ({ ...c, kind: 'padel_court' as const })),
      ...turfBatch
        .filter((c) => {
          const s = (params.courtType || '').toLowerCase();
          if (s.includes('futsal') && !c.supportedSports?.includes('futsal'))
            return false;
          if (s.includes('cricket') && !c.supportedSports?.includes('cricket'))
            return false;
          return true;
        })
        .map((c) => ({ ...c, kind: 'turf_court' as const })),
      ...tableTennisAvailBatch.map((c) => ({
        ...c,
        kind: 'table_tennis_court' as const,
      })),
    ];

    const getFacilitiesForDate = async (targetDate: string) => {
      const results = await Promise.all(
        allCourts.map(async (c) => {
          const slots = await this.getCourtSlots(c.tenantId, {
            kind: c.kind,
            courtId: c.id,
            date: targetDate,
            startTime: start,
            endTime: end,
          });
          const isAvailable = slots.slots.some(
            (s: any) =>
              s.startTime === params.startTime &&
              s.endTime === end &&
              s.availability === 'available',
          );
          return isAvailable
            ? {
                kind: c.kind,
                courtId: c.id,
                name: c.name,
                price:
                  c.kind === 'padel_court'
                    ? Number((c as any).pricePerSlot ?? 0)
                    : c.kind === 'table_tennis_court'
                      ? this.resolveTableTennisPrice(
                          c as any,
                          params.tableTennisPlayType,
                        )
                      : this.resolveTurfPrice(c, params.courtType),
              }
            : null;
        }),
      );
      return results.filter(
        (f): f is { kind: CourtKind; courtId: string; name: string; price: number } =>
          f !== null,
      );
    };

    const [facilities, nextDayFacilities] = await Promise.all([
      getFacilitiesForDate(date),
      getFacilitiesForDate(nextDate),
    ]);

    return {
      date,
      nextDayDate: nextDate,
      locationId: params.locationId,
      startTime: params.startTime,
      endTime: end,
      facilities,
      nextDayFacilities,
    };
  }

  async getLocationEmptySlots30Days(params: {
    locationId: string;
    courtType?: string;
  }) {
    const startDate = getCurrentDateInKarachi();
    const endDate = addDays(startDate, 29);
    const days: string[] = Array.from({ length: 30 }, (_, i) =>
      addDays(startDate, i),
    );

    const kinds = this.normalizeKindForEmptySlotCounts(params.courtType);
    const includePadel = kinds.includes('padel_court');
    const includeTurf = kinds.includes('turf_court');
    const includeTableTennis = kinds.includes('table_tennis_court');

    const [padelBatch, turfBatch, tableTennisBatch] = await Promise.all([
      includePadel
        ? this.padelRepo.find({
            where: {
              businessLocationId: params.locationId,
              isActive: true,
              courtStatus: In(['active', 'draft']) as any,
            },
            select: ['id'],
          })
        : Promise.resolve([]),
      includeTurf
        ? this.turfRepo.find({
            where: { branchId: params.locationId, status: 'active' },
            select: ['id'],
          })
        : Promise.resolve([]),
      includeTableTennis
        ? this.tableTennisRepo.find({
            where: {
              businessLocationId: params.locationId,
              isActive: true,
              courtStatus: In(['active', 'draft']) as any,
            },
            select: ['id'],
          })
        : Promise.resolve([]),
    ]);

    const courtPairs: Array<{ kind: CourtKind; courtId: string }> = [
      ...padelBatch.map((c) => ({ kind: 'padel_court' as const, courtId: c.id })),
      ...turfBatch.map((c) => ({ kind: 'turf_court' as const, courtId: c.id })),
      ...tableTennisBatch.map((c) => ({
        kind: 'table_tennis_court' as const,
        courtId: c.id,
      })),
    ];

    if (courtPairs.length === 0) {
      return {
        locationId: params.locationId,
        startDate,
        endDate,
        courtType: params.courtType ?? 'all',
        daily: days.map((date) => ({ date, emptySlots: 0 })),
      };
    }

    const qb = this.facilitySlotRepo
      .createQueryBuilder('fs')
      .select('fs.slotDate', 'slotDate')
      .addSelect('COUNT(*)::int', 'emptySlots')
      .where('fs.slotDate BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .andWhere("fs.status = 'available'");

    qb.andWhere(
      new Brackets((subQb) => {
        courtPairs.forEach((pair, idx) => {
          const kindKey = `kind${idx}`;
          const courtIdKey = `courtId${idx}`;
          subQb.orWhere(
            `(fs.courtKind = :${kindKey} AND fs.courtId = :${courtIdKey})`,
            {
              [kindKey]: pair.kind,
              [courtIdKey]: pair.courtId,
            },
          );
        });
      }),
    );

    const rows = await qb
      .groupBy('fs.slotDate')
      .orderBy('fs.slotDate', 'ASC')
      .getRawMany<{ slotDate: string; emptySlots: string }>();

    const countByDate = new Map<string, number>(
      rows.map((row) => [row.slotDate, Number(row.emptySlots) || 0]),
    );

    return {
      locationId: params.locationId,
      startDate,
      endDate,
      courtType: params.courtType ?? 'all',
      daily: days.map((date) => ({
        date,
        emptySlots: countByDate.get(date) ?? 0,
      })),
    };
  }

  private normalizePadelFacilityToCourtKind(raw: string): CourtKind {
    const s = raw.trim().toLowerCase().replace(/-/g, '_');
    if (s === 'padel' || s === 'padel_court') return 'padel_court';
    if (s === 'futsal' || s === 'cricket' || s === 'turf' || s === 'turf_court')
      return 'turf_court';
    throw new BadRequestException('Invalid facilitySelected type');
  }

  private normalizeKindForAvail(raw?: string): CourtKind[] {
    if (!raw) return ['padel_court', 'turf_court'];
    const s = raw.toLowerCase().trim();
    if (s === 'padel' || s === 'padel_court') return ['padel_court'];
    if (s === 'futsal' || s === 'cricket' || s === 'turf' || s === 'turf_court')
      return ['turf_court'];
    if (
      s === 'table-tennis' ||
      s === 'table_tennis' ||
      s === 'table_tennis_court' ||
      s === 'tabletennis'
    ) {
      return ['table_tennis_court'];
    }
    return ['padel_court', 'turf_court'];
  }

  private normalizeKindForEmptySlotCounts(raw?: string): CourtKind[] {
    if (!raw) return ['padel_court', 'turf_court', 'table_tennis_court'];
    const s = raw.toLowerCase().trim();
    if (s === 'padel' || s === 'padel_court') return ['padel_court'];
    if (s === 'futsal' || s === 'cricket' || s === 'turf' || s === 'turf_court')
      return ['turf_court'];
    if (
      s === 'table-tennis' ||
      s === 'table_tennis' ||
      s === 'table_tennis_court' ||
      s === 'tabletennis'
    ) {
      return ['table_tennis_court'];
    }
    return ['padel_court', 'turf_court', 'table_tennis_court'];
  }

  async placePadelBooking(
    dto: PlacePadelBookingDto,
  ): Promise<{ message: string; bookingId: string; placedAt: string }> {
    const loc = await this.locationRepo.findOne({ where: { id: dto.venueId } });
    if (!loc) throw new NotFoundException(`Venue ${dto.venueId} not found`);
    const business = await this.businessRepo.findOne({
      where: { id: loc.businessId },
    });
    if (!business)
      throw new BadRequestException('Venue has no business record');
    const tenantId = business.tenantId;
    const courtKind = this.normalizePadelFacilityToCourtKind(
      dto.facilitySelected,
    );
    const court = await this.assertPadelCourtExists(
      tenantId,
      dto.fieldSelected,
    );
    if ((court.businessLocationId ?? '') !== dto.venueId) {
      throw new BadRequestException(
        'Selected court does not belong to this venue',
      );
    }

    const price = Number(court.pricePerSlot || 0);

    const booking = await this.create(tenantId, {
      userId: dto.userId,
      sportType: 'padel',
      bookingDate: dto.date.slice(0, 10),
      items: [
        {
          courtKind,
          courtId: dto.fieldSelected,
          startTime: dto.startTime,
          endTime: dto.endTime,
          price,
          currency: loc.currency ?? 'PKR',
          status: 'confirmed',
        },
      ],
      pricing: { subTotal: price, discount: 0, tax: 0, totalAmount: price },
      payment: { paymentStatus: 'pending', paymentMethod: 'cash' },
      bookingStatus: 'confirmed',
    });
    return {
      message: 'Booking placed successfully',
      bookingId: booking.bookingId,
      placedAt: booking.createdAt,
    };
  }

  async syncFacilitySlotsStatusById(
    tenantId: string,
    bookingId: string,
  ): Promise<void> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, tenantId },
      relations: ['items'],
    });
    if (!booking) return;
    await this.syncFacilitySlotsStatus(booking);
  }

  private async syncFacilitySlotsStatus(booking: Booking): Promise<void> {
    if (!booking.items?.length) return;

    for (const item of booking.items) {
      // A slot is considered 'blocked' if the booking is not cancelled/no-show 
      // AND the item itself is not cancelled.
      const isBookingActive =
        booking.bookingStatus === 'confirmed' ||
        booking.bookingStatus === 'live' ||
        booking.bookingStatus === 'pending';
      
      const isItemActive = item.itemStatus !== 'cancelled';
      
      const targetStatus: CourtFacilitySlotStatus =
        isBookingActive && isItemActive ? 'blocked' : 'available';

      const fallbackDate = formatDateOnly(item.date ?? booking.bookingDate);
      const itemWindow = this.toSlotDateTimes(
        fallbackDate,
        item.startTime,
        item.endTime,
      );
      const itemStart = item.startDatetime ?? itemWindow.startDatetime;
      const itemEnd = item.endDatetime ?? itemWindow.endDatetime;

      const startDateIso = formatDateOnly(itemStart);
      const endDateIso = formatDateOnly(itemEnd);

      let totalAffected = 0;
      for (
        let slotDate = startDateIso;
        slotDate <= endDateIso;
        slotDate = addDays(slotDate, 1)
      ) {
        const dayStart = new Date(`${slotDate}T00:00:00Z`);
        const nextDay = addDays(slotDate, 1);
        const dayEnd = new Date(`${nextDay}T00:00:00Z`);
        const windowStartDate = new Date(
          Math.max(itemStart.getTime(), dayStart.getTime()),
        );
        const windowEndDate = new Date(
          Math.min(itemEnd.getTime(), dayEnd.getTime()),
        );
        if (windowEndDate <= windowStartDate) continue;
        const windowStart = windowStartDate.toISOString().slice(11, 16);
        const windowEnd = windowEndDate.toISOString().slice(11, 16);
        const effectiveEnd =
          windowEnd === '00:00' && windowEndDate.getTime() === dayEnd.getTime()
            ? '24:00'
            : windowEnd;

        const updateResult = await this.facilitySlotRepo
          .createQueryBuilder()
          .update(CourtFacilitySlot)
          .set({ status: targetStatus })
          .where('tenantId = :tenantId', { tenantId: booking.tenantId })
          .andWhere('courtKind = :courtKind', { courtKind: item.courtKind })
          .andWhere('courtId = :courtId', { courtId: item.courtId })
          .andWhere('slotDate = :slotDate', { slotDate })
          .andWhere('startTime < :endTime', { endTime: effectiveEnd })
          .andWhere('endTime > :startTime', { startTime: windowStart })
          .execute();
        totalAffected += updateResult.affected ?? 0;
      }

      console.log(
        `[syncFacilitySlotsStatus] Booking ${booking.id} (${booking.bookingStatus}): ` +
          `Updated ${totalAffected} slots to ${targetStatus} for court ${item.courtId} ` +
          `across ${startDateIso}..${endDateIso} ${item.startTime}-${item.endTime}`,
      );
    }
  }

  private async setFacilitySlotsStatusForItems(params: {
    tenantId: string;
    items: BookingItem[];
    targetStatus: CourtFacilitySlotStatus;
    excludeBookingId?: string;
  }): Promise<void> {
    const { tenantId, items, targetStatus, excludeBookingId } = params;
    if (!items.length) return;

    for (const item of items) {
      const fallbackDate = formatDateOnly(
        item.date ?? item.startDatetime ?? item.endDatetime ?? new Date(),
      );
      const itemWindow = this.toSlotDateTimes(
        fallbackDate,
        item.startTime,
        item.endTime,
      );
      const itemStart = item.startDatetime ?? itemWindow.startDatetime;
      const itemEnd = item.endDatetime ?? itemWindow.endDatetime;
      const startDateIso = formatDateOnly(itemStart);
      const endDateIso = formatDateOnly(itemEnd);

      for (
        let slotDate = startDateIso;
        slotDate <= endDateIso;
        slotDate = addDays(slotDate, 1)
      ) {
        const dayStart = new Date(`${slotDate}T00:00:00Z`);
        const nextDay = addDays(slotDate, 1);
        const dayEnd = new Date(`${nextDay}T00:00:00Z`);
        const windowStartDate = new Date(
          Math.max(itemStart.getTime(), dayStart.getTime()),
        );
        const windowEndDate = new Date(
          Math.min(itemEnd.getTime(), dayEnd.getTime()),
        );
        if (windowEndDate <= windowStartDate) continue;
        const windowStart = windowStartDate.toISOString().slice(11, 16);
        const windowEnd = windowEndDate.toISOString().slice(11, 16);
        const effectiveEnd =
          windowEnd === '00:00' && windowEndDate.getTime() === dayEnd.getTime()
            ? '24:00'
            : windowEnd;

        if (targetStatus === 'blocked') {
          await this.facilitySlotRepo
            .createQueryBuilder()
            .update(CourtFacilitySlot)
            .set({ status: targetStatus })
            .where('tenantId = :tenantId', { tenantId })
            .andWhere('courtKind = :courtKind', { courtKind: item.courtKind })
            .andWhere('courtId = :courtId', { courtId: item.courtId })
            .andWhere('slotDate = :slotDate', { slotDate })
            .andWhere('startTime < :endTime', { endTime: effectiveEnd })
            .andWhere('endTime > :startTime', { startTime: windowStart })
            .execute();
          continue;
        }

        const candidateSlots = await this.facilitySlotRepo.find({
          where: {
            tenantId,
            courtKind: item.courtKind,
            courtId: item.courtId,
            slotDate,
          },
          select: ['slotDate', 'startTime', 'endTime'],
        });

        for (const slot of candidateSlots) {
          if (
            toMinutes(slot.startTime, false) >= toMinutes(effectiveEnd, true) ||
            toMinutes(slot.endTime, true) <= toMinutes(windowStart, false)
          ) {
            continue;
          }

          const slotStart = new Date(`${slot.slotDate}T${slot.startTime}:00Z`);
          const slotEnd = new Date(`${slot.slotDate}T${slot.endTime}:00Z`);
          const overlapQb = this.bookingRepo
            .createQueryBuilder('b')
            .innerJoin('b.items', 'i')
            .where('b.tenantId = :tenantId', { tenantId })
            .andWhere("b.bookingStatus IN ('pending', 'confirmed', 'live', 'completed')")
            .andWhere("i.itemStatus <> 'cancelled'")
            .andWhere('i.courtKind = :courtKind', { courtKind: item.courtKind })
            .andWhere('i.courtId = :courtId', { courtId: item.courtId })
            .andWhere('i.startDatetime < :slotEnd', {
              slotEnd: slotEnd.toISOString(),
            })
            .andWhere('i.endDatetime > :slotStart', {
              slotStart: slotStart.toISOString(),
            });
          if (excludeBookingId) {
            overlapQb.andWhere('b.id <> :excludeBookingId', { excludeBookingId });
          }
          const overlapCount = await overlapQb.getCount();
          if (overlapCount > 0) continue;

          await this.facilitySlotRepo.update(
            {
              tenantId,
              courtKind: item.courtKind,
              courtId: item.courtId,
              slotDate: slot.slotDate,
              startTime: slot.startTime,
            },
            { status: 'available' },
          );
        }
      }
    }
  }

  async completePastBookings() {
    const now = new Date();

    // Auto-cancel bookings that never started (still pending/confirmed) after end time.
    const noShowBookings = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.items', 'i')
      .where("b.bookingStatus IN ('pending', 'confirmed')")
      .groupBy('b.id')
      .having('MAX(i.endDatetime) < :now', { now: now.toISOString() })
      .select('b.id', 'id')
      .getRawMany<{ id: string }>();
    if (noShowBookings.length > 0) {
      const ids = noShowBookings.map((b) => b.id);
      const rows = await this.bookingRepo.find({
        where: { id: In(ids) },
        relations: ['items'],
      });
      for (const booking of rows) {
        booking.bookingStatus = 'cancelled';
        booking.cancellationReason =
          booking.cancellationReason ||
          'Auto-cancelled because booking was not started before end time.';
        for (const item of booking.items ?? []) {
          item.itemStatus = 'cancelled';
        }
        await this.bookingRepo.save(booking);
        await this.syncFacilitySlotsStatus(booking);
      }
      this.logger.log(
        `Auto-cancelled ${rows.length} unstarted bookings past end time.`,
      );
    }

    // Complete only live bookings once their play window has ended.
    const pastBookings = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.items', 'i')
      .where("b.bookingStatus = 'live'")
      .groupBy('b.id')
      .having('MAX(i.endDatetime) < :now', { now: now.toISOString() })
      .select('b.id', 'id')
      .getRawMany<{ id: string }>();

    if (pastBookings.length === 0) return;

    const ids = pastBookings.map((b) => b.id);
    const liveBookings = await this.bookingRepo.find({
      where: { id: In(ids), bookingStatus: 'live' },
      relations: ['items'],
    });
    for (const booking of liveBookings) {
      let extraSubTotal = 0;
      for (const item of booking.items ?? []) {
        if (item.itemStatus === 'cancelled') continue;
        if (!item.startDatetime || !item.endDatetime) continue;
        if (now <= item.endDatetime) continue;

        const durationMinutes = Math.max(
          1,
          Math.round(
            (item.endDatetime.getTime() - item.startDatetime.getTime()) / 60000,
          ),
        );
        const perMinuteRate = numFromDec(item.price) / durationMinutes;
        const overtimeMinutes = Math.max(
          0,
          Math.ceil((now.getTime() - item.endDatetime.getTime()) / 60000),
        );
        if (overtimeMinutes <= 0) continue;

        const overtimeCharge = Number((perMinuteRate * overtimeMinutes).toFixed(2));
        extraSubTotal += overtimeCharge;
        item.price = dec(numFromDec(item.price) + overtimeCharge);
        item.endDatetime = now;
        item.endTime = now.toISOString().slice(11, 16);
        item.date = now.toISOString().slice(0, 10);
        item.itemStatus = 'cancelled';
      }

      if (extraSubTotal > 0) {
        booking.subTotal = dec(numFromDec(booking.subTotal) + extraSubTotal);
        booking.totalAmount = dec(
          this.computePayableAmount(
            numFromDec(booking.subTotal),
            numFromDec(booking.discount),
            numFromDec(booking.tax),
          ),
        );
        harmonizePaymentStatusWithAmounts(booking);
      }
      await this.bookingRepo.save(booking);
    }
    await this.bookingRepo.update({ id: In(ids) }, { bookingStatus: 'completed' });
    for (const booking of liveBookings) {
      booking.bookingStatus = 'completed';
      await this.syncFacilitySlotsStatus(booking);
    }
    this.logger.log(`Marked ${ids.length} active bookings as completed.`);
  }
}
