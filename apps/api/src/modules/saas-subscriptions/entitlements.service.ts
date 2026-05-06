import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../businesses/entities/business.entity';
import { BusinessLocation } from '../businesses/entities/business-location.entity';
import { BillingService } from '../billing/billing.service';
import { IamService } from '../iam/iam.service';
import { normalizePlanId, PLAN_ENTITLEMENTS } from './plan-catalog';
import type {
  EntitlementsSnapshot,
  SaasFeature,
  SaasPlanId,
} from './saas-subscription.types';

@Injectable()
export class EntitlementsService {
  constructor(
    @InjectRepository(Business)
    private readonly businessesRepository: Repository<Business>,
    @InjectRepository(BusinessLocation)
    private readonly locationsRepository: Repository<BusinessLocation>,
    private readonly billingService: BillingService,
    private readonly iamService: IamService,
  ) {}

  isSubscriptionStatusActive(status: string | undefined): boolean {
    return (status ?? 'active').trim().toLowerCase() === 'active';
  }

  async getSnapshotForTenant(tenantId: string): Promise<EntitlementsSnapshot> {
    const business = await this.businessesRepository.findOne({
      where: { tenantId },
    });
    if (!business) {
      throw new NotFoundException(`No business registered for tenant ${tenantId}`);
    }
    return this.snapshotFromBusiness(tenantId, business);
  }

  snapshotFromBusiness(tenantId: string, business: Business): EntitlementsSnapshot {
    const sub = business.subscription ?? {};
    const planId: SaasPlanId = normalizePlanId(sub.plan);
    const subscriptionStatus = (sub.status ?? 'active').trim().toLowerCase();
    const isPayingActive = this.isSubscriptionStatusActive(subscriptionStatus);
    const base = PLAN_ENTITLEMENTS[planId];

    const features = { ...base.features };
    const pricingPlan = this.billingService.getLatestPricingPlanForTenant(tenantId);
    if (pricingPlan) {
      (Object.keys(features) as SaasFeature[]).forEach((key) => {
        features[key] = pricingPlan.features.includes(key);
      });
    }
    if (!isPayingActive) {
      (Object.keys(features) as SaasFeature[]).forEach((k) => {
        features[k] = false;
      });
    }

    return {
      tenantId,
      planId,
      subscriptionStatus,
      billingCycle: pricingPlan?.billingPeriod ?? sub.billingCycle?.trim() ?? null,
      isPayingActive,
      features,
      limits: {
        maxBusinessLocations:
          pricingPlan?.maxBusinessLocations ?? base.maxBusinessLocations,
      },
    };
  }

  async assertFeaturesAllowed(
    tenantId: string,
    requesterUserId: string,
    required: SaasFeature[],
  ): Promise<void> {
    if (required.length === 0) return;

    const bypass = await this.iamService.hasAnyRole(requesterUserId, [
      'platform-owner',
    ]);
    if (bypass) return;

    const tid = tenantId?.trim();
    if (!tid || tid === 'public') {
      throw new ForbiddenException(
        'Send x-tenant-id for the business to use this feature',
      );
    }

    const snap = await this.getSnapshotForTenant(tid);
    const missing = required.filter((f) => !snap.features[f]);
    if (missing.length > 0) {
      throw new ForbiddenException(
        `This action requires an active subscription with: ${missing.join(', ')} (plan=${snap.planId})`,
      );
    }
  }

  /**
   * Enforces {@link EntitlementsSnapshot.limits.maxBusinessLocations} for the given business.
   * Platform owners skip the cap.
   */
  async assertCanCreateBusinessLocation(
    requesterUserId: string,
    businessId: string,
  ): Promise<void> {
    const bypass = await this.iamService.hasAnyRole(requesterUserId, [
      'platform-owner',
    ]);
    if (bypass) return;

    const business = await this.businessesRepository.findOne({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException(`Business ${businessId} not found`);

    const snap = this.snapshotFromBusiness(business.tenantId, business);
    const max = snap.limits.maxBusinessLocations;
    if (max == null) return;

    const count = await this.locationsRepository.count({
      where: { businessId },
    });
    if (count >= max) {
      throw new ForbiddenException(
        `Location limit reached for plan "${snap.planId}" (${max}). Upgrade to add more branches.`,
      );
    }
  }
}
