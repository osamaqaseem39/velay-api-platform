import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectTournamentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
