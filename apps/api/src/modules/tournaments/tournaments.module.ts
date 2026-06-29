import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IamModule } from '../iam/iam.module';
import { BookingsModule } from '../bookings/bookings.module';
import { BusinessLocation } from '../businesses/entities/business-location.entity';
import { Business } from '../businesses/entities/business.entity';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { Tournament } from './entities/tournament.entity';
import { TournamentDivision } from './entities/tournament-division.entity';
import { TournamentConfigVersion } from './entities/tournament-config-version.entity';
import { TournamentStage } from './entities/tournament-stage.entity';
import { TournamentRegistration } from './entities/tournament-registration.entity';
import { TournamentGroup } from './entities/tournament-group.entity';
import { GroupMember } from './entities/group-member.entity';
import { TournamentMatch } from './entities/tournament-match.entity';
import { TournamentFixture } from './entities/tournament-fixture.entity';
import { BracketNode } from './entities/bracket-node.entity';
import { Standing } from './entities/standing.entity';
import { TournamentAuditLog } from './entities/tournament-audit-log.entity';
import { BookingItem } from '../bookings/entities/booking-item.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { TournamentsController } from './controllers/tournaments.controller';
import { PlatformTournamentsController } from './controllers/platform-tournaments.controller';
import { RegistrationsController } from './controllers/registrations.controller';
import { MatchesController } from './controllers/matches.controller';
import {
  MyTournamentRegistrationsController,
  PublicTournamentsController,
} from './controllers/public-tournaments.controller';
import { TournamentsService } from './services/tournaments.service';
import { RegistrationsService } from './services/registrations.service';
import { MatchesService } from './services/matches.service';
import { FixtureGenerationService } from './services/fixture-generation.service';
import { KnockoutBracketService } from './services/knockout-bracket.service';
import { TournamentAuditService } from './services/tournament-audit.service';
import { TournamentMatchBookingService } from './services/tournament-match-booking.service';

@Module({
  imports: [
    IamModule,
    BookingsModule,
    TypeOrmModule.forFeature([
      Team,
      TeamMember,
      Tournament,
      TournamentDivision,
      TournamentConfigVersion,
      TournamentStage,
      TournamentRegistration,
      TournamentGroup,
      GroupMember,
      TournamentMatch,
      TournamentFixture,
      BracketNode,
      Standing,
      TournamentAuditLog,
      Booking,
      BookingItem,
      BusinessLocation,
      Business,
    ]),
  ],
  controllers: [
    TournamentsController,
    PlatformTournamentsController,
    RegistrationsController,
    MatchesController,
    PublicTournamentsController,
    MyTournamentRegistrationsController,
  ],
  providers: [
    TournamentsService,
    RegistrationsService,
    MatchesService,
    FixtureGenerationService,
    KnockoutBracketService,
    TournamentAuditService,
    TournamentMatchBookingService,
  ],
  exports: [TournamentsService, RegistrationsService, MatchesService],
})
export class TournamentsModule {}
