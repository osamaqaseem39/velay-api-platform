import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { CurrentTenant } from '../../../tenancy/tenant-context.decorator';
import type { TenantContext } from '../../../tenancy/tenant-context.interface';
import { ConsumerAuthGuard } from '../../iam/authz/consumer-auth.guard';
import { RegisterTeamDto } from '../dto/register-team.dto';
import { TournamentsService } from '../services/tournaments.service';
import { RegistrationsService } from '../services/registrations.service';

@Controller('public/tournaments')
@UseGuards(ConsumerAuthGuard)
export class PublicTournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly registrationsService: RegistrationsService,
  ) {}

  private userId(req: Request): string {
    const id = (req as Request & { userId?: string }).userId?.trim();
    if (!id) throw new UnauthorizedException('Missing user');
    return id;
  }

  private tenantId(tenant: TenantContext): string {
    const id = tenant?.tenantId?.trim() ?? '';
    if (!isUUID(id, 4)) {
      throw new UnauthorizedException('Valid X-Tenant-Id required');
    }
    return id;
  }

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('sport') sport?: string,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.tournamentsService.listPublic(this.tenantId(tenant), {
      sport,
      status,
      page,
      limit,
    });
  }

  @Get(':tournamentId')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ) {
    return this.tournamentsService.getPublic(this.tenantId(tenant), tournamentId);
  }

  @Post(':tournamentId/register')
  register(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: RegisterTeamDto,
  ) {
    const key = req.headers['idempotency-key'] as string | undefined;
    return this.registrationsService.register(
      this.tenantId(tenant),
      tournamentId,
      dto,
      this.userId(req),
      key,
    );
  }

  @Get(':tournamentId/matches')
  matches(
    @CurrentTenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ) {
    return this.tournamentsService.getMatches(this.tenantId(tenant), tournamentId);
  }

  @Get(':tournamentId/standings')
  standings(
    @CurrentTenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ) {
    return this.tournamentsService.getPublicStandings(
      this.tenantId(tenant),
      tournamentId,
    );
  }

  @Get(':tournamentId/bracket')
  bracket(
    @CurrentTenant() tenant: TenantContext,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
  ) {
    return this.tournamentsService.getPublicBracket(
      this.tenantId(tenant),
      tournamentId,
    );
  }
}

@Controller('tournaments/me')
@UseGuards(ConsumerAuthGuard)
export class MyTournamentRegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  private userId(req: Request): string {
    const id = (req as Request & { userId?: string }).userId?.trim();
    if (!id) throw new UnauthorizedException('Missing user');
    return id;
  }

  @Get('registrations')
  myRegistrations(@Req() req: Request) {
    return this.registrationsService.listForUser(this.userId(req));
  }
}
