import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TeamMemberInputDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsString()
  @MaxLength(32)
  role!: string;

  @IsOptional()
  @IsInt()
  jerseyNumber?: number;
}

export class RegisterTeamDto {
  @IsOptional()
  @IsUUID('4')
  teamId?: string;

  @IsString()
  @MaxLength(200)
  teamName!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeamMemberInputDto)
  members?: TeamMemberInputDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  minPlayers?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPlayers?: number;
}
