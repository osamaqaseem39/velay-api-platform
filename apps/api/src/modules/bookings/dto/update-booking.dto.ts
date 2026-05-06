import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  BOOKING_ITEM_STATUSES,
  BOOKING_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type BookingItemStatus,
  type BookingStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '../types/booking.types';

export class UpdateBookingPaymentDto {
  @IsOptional()
  @IsIn([...PAYMENT_STATUSES])
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsIn([...PAYMENT_METHODS])
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  /**
   * Accepted for backward compatibility with older mobile payloads.
   * Server derives/stores this from totalAmount - paidAmount.
   */
  @IsOptional()
  @IsNumber()
  remainingAmount?: number;
}

export class UpdateBookingPricingDto {
  /**
   * Accepted for backward compatibility with older mobile payloads.
   * PATCH /bookings currently does not update pricing totals from this object.
   */
  @IsOptional()
  @IsNumber()
  subTotal?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsNumber()
  tax?: number;

  @IsOptional()
  @IsNumber()
  totalAmount?: number;
}

export class UpdateBookingItemStatusDto {
  @IsUUID('4')
  itemId!: string;

  @IsIn([...BOOKING_ITEM_STATUSES])
  status!: BookingItemStatus;
}

export class UpdateBookingDto {
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.toLowerCase() === 'cancel'
        ? 'cancelled'
        : value
      : value,
  )
  @IsOptional()
  @IsIn([...BOOKING_STATUSES])
  bookingStatus?: BookingStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  cancellationReason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBookingPaymentDto)
  payment?: UpdateBookingPaymentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBookingPricingDto)
  pricing?: UpdateBookingPricingDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpdateBookingItemStatusDto)
  itemStatuses?: UpdateBookingItemStatusDto[];
}
