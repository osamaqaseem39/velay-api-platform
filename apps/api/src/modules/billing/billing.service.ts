import { Injectable, UnauthorizedException } from '@nestjs/common';
import { IamService } from '../iam/iam.service';
import { randomUUID } from 'crypto';

export interface InvoiceRecord {
  id: string;
  tenantId: string;
  bookingId: string;
  amount: number;
  currency: 'PKR' | 'USD';
  status: 'issued' | 'paid';
}

export interface FacilityChargeRecord {
  facilityType: string;
  amount: number;
}

export interface PricingPlanRecord {
  id: string;
  tenantId: string;
  tierName: string;
  billingPeriod: 'quarterly' | 'biannual' | 'yearly';
  basePrice: number;
  maxBusinessLocations: number | null;
  features: string[];
  facilityCharges: FacilityChargeRecord[];
  createdByUserId: string;
  createdAt: string;
}

@Injectable()
export class BillingService {
  private readonly invoices: InvoiceRecord[] = [];
  private readonly pricingPlans: PricingPlanRecord[] = [];

  constructor(private readonly iamService: IamService) {}

  async list(requesterUserId: string, tenantId?: string): Promise<InvoiceRecord[]> {
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterUserId, ['platform-owner']);
    
    if (tenantId) {
      return this.invoices.filter((invoice) => invoice.tenantId === tenantId);
    }
    
    if (isPlatformOwner) {
      return this.invoices;
    }
    
    throw new UnauthorizedException('Tenant ID is required');
  }

  issue(tenantId: string, bookingId: string, amount: number): InvoiceRecord {
    const invoice: InvoiceRecord = {
      id: randomUUID(),
      tenantId,
      bookingId,
      amount,
      currency: 'PKR',
      status: 'issued',
    };
    this.invoices.push(invoice);
    return invoice;
  }

  async listPricingPlans(
    requesterUserId: string,
    tenantId?: string,
  ): Promise<PricingPlanRecord[]> {
    const isPlatformOwner = await this.iamService.hasAnyRole(requesterUserId, ['platform-owner']);
    if (isPlatformOwner) {
      if (!tenantId) return this.pricingPlans;
      return this.pricingPlans.filter((plan) => plan.tenantId === tenantId);
    }
    if (!tenantId) {
      throw new UnauthorizedException('Tenant ID is required');
    }
    return this.pricingPlans.filter((plan) => plan.tenantId === tenantId);
  }

  async createPricingPlan(input: {
    requesterUserId: string;
    tenantId: string;
    tierName: string;
    billingPeriod: 'quarterly' | 'biannual' | 'yearly';
    basePrice: number;
    maxBusinessLocations?: number;
    features: string[];
    facilityCharges: FacilityChargeRecord[];
  }): Promise<PricingPlanRecord> {
    const isPlatformOwner = await this.iamService.hasAnyRole(input.requesterUserId, ['platform-owner']);
    if (!isPlatformOwner) {
      throw new UnauthorizedException('Only platform owners can create pricing plans');
    }
    const plan: PricingPlanRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      tierName: input.tierName,
      billingPeriod: input.billingPeriod,
      basePrice: input.basePrice,
      maxBusinessLocations:
        Number.isFinite(Number(input.maxBusinessLocations)) && Number(input.maxBusinessLocations) > 0
          ? Number(input.maxBusinessLocations)
          : null,
      features: input.features,
      facilityCharges: input.facilityCharges,
      createdByUserId: input.requesterUserId,
      createdAt: new Date().toISOString(),
    };
    this.pricingPlans.push(plan);
    return plan;
  }

  getLatestPricingPlanForTenant(tenantId: string): PricingPlanRecord | null {
    const rows = this.pricingPlans
      .filter((plan) => plan.tenantId === tenantId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return rows[0] ?? null;
  }
}
