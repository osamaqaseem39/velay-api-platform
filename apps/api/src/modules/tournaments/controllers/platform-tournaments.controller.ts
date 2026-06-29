import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../iam/authz/roles.decorator';
import { RolesGuard } from '../../iam/authz/roles.guard';
import { RejectTournamentDto } from '../dto/reject-tournament.dto';
import { TournamentsService } from '../services/tournaments.service';

@Controller('platform/tournaments')
@UseGuards(RolesGuard)
@Roles('platform-owner')
export class PlatformTournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  private userId(req: Request): string {
    const id = (req as Request & { userId?: string }).userId?.trim();
    if (!id) throw new UnauthorizedException('Missing user');
    return id;
  }

  @Get('pending')
  listPending() {
    return this.tournamentsService.listPendingApproval();
  }

  @Patch(':id/approve')
  approve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournamentsService.approveByPlatform(id, this.userId(req));
  }

  @Patch(':id/reject')
  reject(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTournamentDto,
  ) {
    return this.tournamentsService.rejectByPlatform(
      id,
      dto.reason,
      this.userId(req),
    );
  }
}
