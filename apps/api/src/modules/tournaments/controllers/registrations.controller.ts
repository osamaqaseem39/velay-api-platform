import {
  Body,
  Controller,
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
import { RegistrationsService } from '../services/registrations.service';

@Controller('registrations')
@UseGuards(RolesGuard)
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

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

  @Patch(':id/approve')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  approve(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.registrationsService.approve(
      this.tenantId(tenant),
      id,
      this.userId(req),
    );
  }

  @Patch(':id/mark-paid')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  markPaid(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.registrationsService.markPaid(
      this.tenantId(tenant),
      id,
      this.userId(req),
    );
  }

  @Patch(':id/reject')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  reject(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.registrationsService.reject(
      this.tenantId(tenant),
      id,
      body.reason,
      this.userId(req),
    );
  }
}
