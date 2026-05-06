import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../businesses/entities/business.entity';
import { BusinessLocation } from '../businesses/entities/business-location.entity';
import { BillingModule } from '../billing/billing.module';
import { IamModule } from '../iam/iam.module';
import { EntitlementsService } from './entitlements.service';
import { SaasFeatureGuard } from './saas-feature.guard';
import { SaasSubscriptionsController } from './saas-subscriptions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business, BusinessLocation]),
    IamModule,
    BillingModule,
  ],
  controllers: [SaasSubscriptionsController],
  providers: [EntitlementsService, SaasFeatureGuard],
  exports: [EntitlementsService, SaasFeatureGuard],
})
export class SaasSubscriptionsModule {}
