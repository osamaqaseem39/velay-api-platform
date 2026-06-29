import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { CurrentTenant } from '../../../tenancy/tenant-context.decorator';
import type { TenantContext } from '../../../tenancy/tenant-context.interface';
import { Roles } from '../../iam/authz/roles.decorator';
import { RolesGuard } from '../../iam/authz/roles.guard';
import {
  ScheduleMatchDto,
  SubmitScoreDto,
  UpdateMatchStatusDto,
  WalkoverMatchDto,
} from '../dto/match-ops.dto';
import { MatchesService } from '../services/matches.service';

@Controller('matches')
@UseGuards(RolesGuard)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  private userId(req: Request): string {
    const id = (req as Request & { userId?: string }).userId?.trim();
    if (!id) throw new UnauthorizedException('Missing user');
    return id;
  }

  private tenantId(tenant: TenantContext): string {
    const id = tenant?.tenantId?.trim() ?? '';
    if (!isUUID(id, 4)) {
      throw new UnauthorizedException('Valid X-Tenant-Id required');
    }
    return id;
  }

  @Get(':id')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.matchesService.get(this.tenantId(tenant), id);
  }

  @Patch(':id/schedule')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  schedule(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleMatchDto,
  ) {
    return this.matchesService.schedule(
      this.tenantId(tenant),
      id,
      dto,
      this.userId(req),
    );
  }

  @Patch(':id/start')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  start(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.matchesService.start(
      this.tenantId(tenant),
      id,
      this.userId(req),
    );
  }

  @Patch(':id/submit-score')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  submitScore(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitScoreDto,
  ) {
    return this.matchesService.submitScore(
      this.tenantId(tenant),
      id,
      dto,
      this.userId(req),
    );
  }

  @Patch(':id/approve-result')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  approveResult(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.matchesService.approveResult(
      this.tenantId(tenant),
      id,
      this.userId(req),
    );
  }

  @Patch(':id/status')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  updateStatus(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatchStatusDto,
  ) {
    return this.matchesService.updateStatus(
      this.tenantId(tenant),
      id,
      dto,
      this.userId(req),
    );
  }

  @Patch(':id/walkover')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  walkover(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WalkoverMatchDto,
  ) {
    return this.matchesService.walkover(
      this.tenantId(tenant),
      id,
      dto,
      this.userId(req),
    );
  }
}
