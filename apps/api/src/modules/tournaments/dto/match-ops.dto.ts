import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { MATCH_STATUSES } from '../types/tournament.types';

export class ScheduleMatchDto {
  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsUUID('4')
  venueId?: string;

  @IsOptional()
  @IsString()
  courtKind?: string;

  @IsOptional()
  @IsUUID('4')
  courtId?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class SubmitScoreDto {
  @IsInt()
  @Min(0)
  homeScore!: number;

  @IsInt()
  @Min(0)
  awayScore!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

export class WalkoverMatchDto {
  @IsUUID('4')
  winnerTeamId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateMatchStatusDto {
  @IsIn([...MATCH_STATUSES])
  status!: (typeof MATCH_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
