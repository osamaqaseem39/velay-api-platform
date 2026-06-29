import { IsBoolean, IsOptional } from 'class-validator';

export class GenerateStageOptionsDto {
  @IsOptional()
  @IsBoolean()
  knockoutNextRound?: boolean;
}
