import { IsUUID } from 'class-validator';

export class SwapGroupTeamsDto {
  @IsUUID('4')
  teamIdA!: string;

  @IsUUID('4')
  teamIdB!: string;
}
