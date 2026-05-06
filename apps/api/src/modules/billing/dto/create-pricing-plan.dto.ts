import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class FacilityChargeDto {
  @IsString()
  @MaxLength(80)
  facilityType!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;
}

export class CreatePricingPlanDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  @MaxLength(80)
  tierName!: string;

  @IsIn(['quarterly', 'biannual', 'yearly'])
  billingPeriod!: 'quarterly' | 'biannual' | 'yearly';

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  basePrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  maxBusinessLocations?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  features!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FacilityChargeDto)
  facilityCharges!: FacilityChargeDto[];
}
