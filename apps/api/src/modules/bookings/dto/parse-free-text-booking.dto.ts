import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class ParseFreeTextBookingDto {
  @IsString()
  @MinLength(3)
  message!: string;

  /** When the message omits a year (e.g. "May 08"), this calendar day anchors disambiguation (`YYYY-MM-DD`). */
  @IsOptional()
  @IsDateString()
  referenceDate?: string;
}
