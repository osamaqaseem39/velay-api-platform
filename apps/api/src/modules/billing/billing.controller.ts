import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentTenant } from '../../tenancy/tenant-context.decorator';
import { TenantContext } from '../../tenancy/tenant-context.interface';
import { CreatePricingPlanDto } from './dto/create-pricing-plan.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { BillingService, InvoiceRecord, PricingPlanRecord } from './billing.service';
import { Roles } from '../iam/authz/roles.decorator';
import { RolesGuard } from '../iam/authz/roles.guard';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('invoices')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  listInvoices(@Req() req: Request, @CurrentTenant() tenant: TenantContext): Promise<InvoiceRecord[]> {
    const userId = (req as any).userId?.trim();
    if (!userId) throw new UnauthorizedException('Missing user');
    return this.billingService.list(userId, tenant?.tenantId?.trim() || undefined);
  }

  @Post('invoices')
  issueInvoice(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: IssueInvoiceDto,
  ): InvoiceRecord {
    return this.billingService.issue(
      tenant.tenantId,
      dto.bookingId,
      dto.amount,
    );
  }

  @Get('pricing-plans')
  @UseGuards(RolesGuard)
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  listPricingPlans(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<PricingPlanRecord[]> {
    const userId = (req as any).userId?.trim();
    if (!userId) throw new UnauthorizedException('Missing user');
    return this.billingService.listPricingPlans(
      userId,
      tenant?.tenantId?.trim() || undefined,
    );
  }

  @Post('pricing-plans')
  @UseGuards(RolesGuard)
  @Roles('platform-owner')
  async createPricingPlan(
    @Req() req: Request,
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreatePricingPlanDto,
  ): Promise<PricingPlanRecord> {
    const userId = (req as any).userId?.trim();
    if (!userId) throw new UnauthorizedException('Missing user');
    const resolvedTenantId = String(dto.tenantId || tenant?.tenantId || '').trim();
    if (!resolvedTenantId || resolvedTenantId === 'public') {
      throw new UnauthorizedException('tenantId is required');
    }
    return this.billingService.createPricingPlan({
      requesterUserId: userId,
      tenantId: resolvedTenantId,
      tierName: dto.tierName.trim(),
      billingPeriod: dto.billingPeriod,
      basePrice: Number(dto.basePrice),
      maxBusinessLocations:
        dto.maxBusinessLocations !== undefined
          ? Number(dto.maxBusinessLocations)
          : undefined,
      features: dto.features
        .map((feature) => String(feature || '').trim())
        .filter((feature) => feature.length > 0),
      facilityCharges: dto.facilityCharges.map((charge) => ({
        facilityType: String(charge.facilityType || '').trim(),
        amount: Number(charge.amount),
      })),
    });
  }
}
