import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookingsService } from '../../bookings/bookings.service';
import { BusinessLocation } from '../../businesses/entities/business-location.entity';
import type { TournamentMatch } from '../entities/tournament-match.entity';
import {
  normalizeCourtKind,
  sportTypeForCourtKind,
} from '../utils/court-kind.util';
import { toBookingWallWindow } from '../utils/tournament-wall-time.util';

@Injectable()
export class TournamentMatchBookingService {
  private readonly logger = new Logger(TournamentMatchBookingService.name);

  constructor(
    private readonly bookings: BookingsService,
    @InjectRepository(BusinessLocation)
    private readonly locations: Repository<BusinessLocation>,
  ) {}

  async syncCourtHold(input: {
    tenantId: string;
    match: TournamentMatch;
    scheduledAt: Date;
    durationMinutes: number;
    courtKind: string;
    courtId: string;
    venueId: string;
    actorId: string;
    tournamentName: string;
  }): Promise<string | null> {
    const kind = normalizeCourtKind(input.courtKind);
    if (!kind) return null;

    const location = await this.locations.findOne({
      where: { id: input.venueId },
    });
    const window = toBookingWallWindow(
      input.scheduledAt,
      input.durationMinutes,
      location?.timezone,
    );

    try {
      const created = await this.bookings.create(input.tenantId, {
        userId: input.actorId,
        sportType: sportTypeForCourtKind(kind),
        bookingDate: window.bookingDate,
        items: [
          {
            date: window.bookingDate,
            courtKind: kind,
            courtId: input.courtId,
            startTime: window.startTime,
            endTime: window.endTime,
            price: 0,
            currency: 'PKR',
            status: 'confirmed',
          },
        ],
        pricing: { subTotal: 0, discount: 0, tax: 0, totalAmount: 0 },
        payment: {
          paymentMethod: 'cash',
          paidAmount: 0,
          paymentStatus: 'paid',
        },
        bookingStatus: 'confirmed',
        notes: `Tournament: ${input.tournamentName} · match ${input.match.id.slice(0, 8)}`,
      });
      return created.bookingId;
    } catch (err) {
      this.logger.warn(
        `Court hold failed for match ${input.match.id}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
