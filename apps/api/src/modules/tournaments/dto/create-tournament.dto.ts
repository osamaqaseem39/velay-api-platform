import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TOURNAMENT_STRUCTURE_TYPES } from '../types/tournament.types';

export class CreateTournamentDivisionDto {
  @IsString()
  @MaxLength(64)
  sport!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsDateString()
  registrationOpensAt?: string;

  @IsOptional()
  @IsDateString()
  registrationClosesAt?: string;

  @IsInt()
  @Min(1)
  maxTeams!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  entryFeeAmount?: number;

  @IsOptional()
  @IsString()
  entryFeeCurrency?: string;

  @IsOptional()
  @IsObject()
  prizePool?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsIn([...TOURNAMENT_STRUCTURE_TYPES])
  structureType!: (typeof TOURNAMENT_STRUCTURE_TYPES)[number];

  @IsOptional()
  @IsObject()
  advancement?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  groupCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minTeamsPerGroup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTeamsPerGroup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  matchesPerTeam?: number;
}

export class CreateTournamentDto {
  @IsString()
  @MaxLength(300)
  name!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  venueIds!: string[];

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTournamentDivisionDto)
  divisions?: CreateTournamentDivisionDto[];

  @ValidateIf((o) => !o.divisions?.length)
  @IsString()
  @MaxLength(64)
  sport?: string;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsDateString()
  registrationOpensAt?: string;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsDateString()
  registrationClosesAt?: string;

  @ValidateIf((o) => !o.divisions?.length)
  @IsInt()
  @Min(1)
  maxTeams?: number;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsNumber()
  @Min(0)
  entryFeeAmount?: number;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsString()
  entryFeeCurrency?: string;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsObject()
  prizePool?: Record<string, unknown>;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsString()
  rules?: string;

  @ValidateIf((o) => !o.divisions?.length)
  @IsIn([...TOURNAMENT_STRUCTURE_TYPES])
  structureType?: (typeof TOURNAMENT_STRUCTURE_TYPES)[number];

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsObject()
  advancement?: Record<string, unknown>;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsInt()
  @Min(1)
  groupCount?: number;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsInt()
  @Min(1)
  minTeamsPerGroup?: number;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsInt()
  @Min(1)
  maxTeamsPerGroup?: number;

  @ValidateIf((o) => !o.divisions?.length)
  @IsOptional()
  @IsInt()
  @Min(1)
  matchesPerTeam?: number;
}

export class PreviewStructureDto {
  @IsInt()
  @Min(1)
  teamCount!: number;

  @IsIn([...TOURNAMENT_STRUCTURE_TYPES])
  structureType!: (typeof TOURNAMENT_STRUCTURE_TYPES)[number];

  @IsOptional()
  @IsObject()
  advancement?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  groupCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minTeamsPerGroup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTeamsPerGroup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  matchesPerTeam?: number;
}

export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  venueIds?: string[];

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  sport?: string;

  @IsOptional()
  @IsDateString()
  registrationOpensAt?: string;

  @IsOptional()
  @IsDateString()
  registrationClosesAt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTeams?: number;

  @IsOptional()
  @IsNumber()
  entryFeeAmount?: number;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsObject()
  prizePool?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsIn([...TOURNAMENT_STRUCTURE_TYPES])
  structureType?: (typeof TOURNAMENT_STRUCTURE_TYPES)[number];

  @IsOptional()
  @IsObject()
  advancement?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  groupCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  minTeamsPerGroup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxTeamsPerGroup?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  matchesPerTeam?: number;
}
