import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { CurrentTenant } from '../../../tenancy/tenant-context.decorator';
import type { TenantContext } from '../../../tenancy/tenant-context.interface';
import { Roles } from '../../iam/authz/roles.decorator';
import { RolesGuard } from '../../iam/authz/roles.guard';
import {
  CreateTournamentDto,
  PreviewStructureDto,
  UpdateTournamentDto,
} from '../dto/create-tournament.dto';
import { TournamentsService } from '../services/tournaments.service';
import { RegistrationsService } from '../services/registrations.service';
import { RegisterTeamDto } from '../dto/register-team.dto';
import { SwapGroupTeamsDto } from '../dto/swap-group-teams.dto';
import { GenerateStageOptionsDto } from '../dto/generate-stage-options.dto';

@Controller()
@UseGuards(RolesGuard)
export class TournamentsController {
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

  @Get('tournaments')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  list(@CurrentTenant() tenant: TenantContext) {
    return this.tournamentsService.list(this.tenantId(tenant));
  }

  @Post('tournaments')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  create(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body() dto: CreateTournamentDto,
  ) {
    return this.tournamentsService.create(
      this.tenantId(tenant),
      dto,
      this.userId(req),
    );
  }

  @Post('tournaments/preview-structure')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  previewStructure(@Body() dto: PreviewStructureDto) {
    return this.tournamentsService.previewStructure(dto);
  }

  @Get('tournament-templates')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  templates() {
    return this.tournamentsService.getTemplates();
  }

  @Get('tournaments/events/:eventId')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  getEvent(
    @CurrentTenant() tenant: TenantContext,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.tournamentsService.getEvent(this.tenantId(tenant), eventId);
  }

  @Get('tournaments/:id')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.get(this.tenantId(tenant), id);
  }

  @Patch('tournaments/:id')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTournamentDto,
  ) {
    return this.tournamentsService.update(
      this.tenantId(tenant),
      id,
      dto,
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/publish')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  publish(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'publish',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/resubmit')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  resubmit(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'resubmit',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/open-registration')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  openRegistration(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'open_registration',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/close-registration')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  closeRegistration(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'close_registration',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/mark-ready')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  markReady(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'mark_ready',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/start')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  start(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'start',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/complete')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  complete(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'complete',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/reopen')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  reopen(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'reopen',
      this.userId(req),
    );
  }

  @Patch('tournaments/:id/cancel')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.transition(
      this.tenantId(tenant),
      id,
      'cancel',
      this.userId(req),
    );
  }

  @Post('tournaments/:id/generate-stage/:stageOrder')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  generateStage(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageOrder', ParseIntPipe) stageOrder: number,
    @Body() body?: GenerateStageOptionsDto,
  ) {
    if (body?.knockoutNextRound) {
      return this.tournamentsService.generateKnockoutRound(
        this.tenantId(tenant),
        id,
        stageOrder,
      );
    }
    return this.tournamentsService.generateStage(
      this.tenantId(tenant),
      id,
      stageOrder,
    );
  }

  @Post('tournaments/:id/reset-stage/:stageOrder')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  resetStage(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageOrder', ParseIntPipe) stageOrder: number,
  ) {
    return this.tournamentsService.resetStage(
      this.tenantId(tenant),
      id,
      stageOrder,
    );
  }

  @Get('tournaments/:id/stages')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  stages(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getStages(this.tenantId(tenant), id);
  }

  @Get('tournaments/:id/fixtures')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  fixtures(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getFixtures(this.tenantId(tenant), id);
  }

  @Get('tournaments/:id/matches')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  matches(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getMatches(this.tenantId(tenant), id);
  }

  @Get('tournaments/:id/standings')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  standings(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getStandings(this.tenantId(tenant), id);
  }

  @Get('tournaments/:id/knockout-results')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  knockoutResults(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getKnockoutResults(this.tenantId(tenant), id);
  }

  @Get('tournaments/:id/knockout-round-status')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  knockoutRoundStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getKnockoutRoundStatus(this.tenantId(tenant), id);
  }

  @Post('tournaments/:id/generate-knockout-round/:stageOrder')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  generateKnockoutRoundFlat(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageOrder', ParseIntPipe) stageOrder: number,
  ) {
    return this.tournamentsService.generateKnockoutRound(
      this.tenantId(tenant),
      id,
      stageOrder,
    );
  }

  @Post('tournaments/:id/knockout/generate-round/:stageOrder')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  generateKnockoutRound(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageOrder', ParseIntPipe) stageOrder: number,
  ) {
    return this.tournamentsService.generateKnockoutRound(
      this.tenantId(tenant),
      id,
      stageOrder,
    );
  }

  @Get('tournaments/:id/bracket')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  bracket(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.getBracket(this.tenantId(tenant), id);
  }

  @Post('tournaments/:id/register-team')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  registerTeam(
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegisterTeamDto,
  ) {
    const key = req.headers['idempotency-key'] as string | undefined;
    return this.registrationsService.register(
      this.tenantId(tenant),
      id,
      dto,
      this.userId(req),
      key,
    );
  }

  @Post('tournaments/:id/groups/swap-teams')
  @Roles('platform-owner', 'business-admin', 'location-admin')
  swapGroupTeams(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SwapGroupTeamsDto,
  ) {
    return this.tournamentsService.swapGroupTeams(
      this.tenantId(tenant),
      id,
      dto.teamIdA,
      dto.teamIdB,
    );
  }

  @Get('tournaments/:id/registrations')
  @Roles('platform-owner', 'business-admin', 'location-admin', 'business-staff')
  listRegistrations(@Param('id', ParseUUIDPipe) id: string) {
    return this.registrationsService.listForTournament(id);
  }
}
