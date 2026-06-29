import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { BookingsService } from '../bookings.service';
import { PadelCourt } from '../../arena/padel-court/entities/padel-court.entity';
import { TableTennisCourt } from '../../arena/table-tennis-court/entities/table-tennis-court.entity';
import { TurfCourt } from '../../arena/turf/entities/turf-court.entity';
import { CourtFacilitySlot } from '../entities/court-facility-slot.entity';

@Injectable()
export class BookingsSlotsTask {
  private readonly logger = new Logger(BookingsSlotsTask.name);
  private readonly slotsTimeZone = 'Asia/Karachi';

  constructor(
    private readonly bookingsService: BookingsService,
    @InjectRepository(PadelCourt)
    private readonly padelRepo: Repository<PadelCourt>,
    @InjectRepository(TurfCourt)
    private readonly turfRepo: Repository<TurfCourt>,
    @InjectRepository(TableTennisCourt)
    private readonly tableTennisRepo: Repository<TableTennisCourt>,
    @InjectRepository(CourtFacilitySlot)
    private readonly facilitySlotRepo: Repository<CourtFacilitySlot>,
  ) {}

  private getCurrentSlotDateTime() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.slotsTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    const hh = parts.find((p) => p.type === 'hour')?.value;
    const mm = parts.find((p) => p.type === 'minute')?.value;

    return {
      today: `${y}-${m}-${d}`,
      currentTime: `${hh}:${mm}`,
    };
  }

  /** First UTC instant (ms) that falls on `ymd` in `timeZone` (start of that local calendar day). */
  private zonedDayStartUtcMs(ymd: string, timeZone: string): number {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [yStr, mStr, dStr] = ymd.split('-');
    const y = Number(yStr);
    const mo = Number(mStr);
    const da = Number(dStr);
    let probe = Date.UTC(y, mo - 1, da, 12, 0, 0);
    let found = false;
    for (let k = -14; k <= 14; k++) {
      const p = Date.UTC(y, mo - 1, da + k, 12, 0, 0);
      if (formatter.format(new Date(p)) === ymd) {
        probe = p;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(
        `zonedDayStartUtcMs: could not locate ${ymd} in ${timeZone}`,
      );
    }
    let t = probe;
    const minuteMs = 60 * 1000;
    while (
      t > probe - 50 * 3600000 &&
      formatter.format(new Date(t)) === ymd
    ) {
      t -= minuteMs;
    }
    const start = t + minuteMs;
    if (formatter.format(new Date(start)) !== ymd) {
      throw new Error(
        `zonedDayStartUtcMs: could not resolve start of ${ymd} in ${timeZone}`,
      );
    }
    return start;
  }

  /** Next calendar date after `ymd` in `timeZone` (YYYY-MM-DD). */
  private addCalendarDaysOne(ymd: string, timeZone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const start = this.zonedDayStartUtcMs(ymd, timeZone);
    for (let h = 1; h <= 50; h++) {
      const next = formatter.format(new Date(start + h * 3600000));
      if (next !== ymd) return next;
    }
    throw new Error(
      `addCalendarDaysOne: could not advance from ${ymd} in ${timeZone}`,
    );
  }

  /** Rolling window of calendar dates in `slotsTimeZone`, aligned with cleanup logic. */
  private getRollingZonedDateStrings(count: number): string[] {
    const { today } = this.getCurrentSlotDateTime();
    const dates: string[] = [];
    let cur = today;
    for (let i = 0; i < count; i++) {
      dates.push(cur);
      if (i < count - 1) {
        cur = this.addCalendarDaysOne(cur, this.slotsTimeZone);
      }
    }
    return dates;
  }

  private async cleanupPastFacilitySlots(includePastTimesToday = false) {
    const { today, currentTime } = this.getCurrentSlotDateTime();
    const deleteOlderDateResult = await this.facilitySlotRepo.delete({
      slotDate: LessThan(today),
    });

    let deletedCount = deleteOlderDateResult.affected ?? 0;
    if (includePastTimesToday) {
      const deletePastTimeTodayResult = await this.facilitySlotRepo.delete({
        slotDate: today,
        endTime: LessThanOrEqual(currentTime),
      });
      deletedCount += deletePastTimeTodayResult.affected ?? 0;
    }

    this.logger.log(
      `Cleaned up ${deletedCount} expired facility slots (today=${today}, now=${currentTime}).`,
    );
  }

  /**
   * Run every day at midnight to:
   * 1. Delete past slots.
   * 2. Populate slots for the next 30 days.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleSlotMaintenance() {
    this.logger.log('Starting daily slot maintenance task...');

    // 1. Cleanup past slots (older than today)
    try {
      await this.cleanupPastFacilitySlots();
    } catch (err) {
      this.logger.error('Failed to cleanup past slots', err);
    }

    // 2. Generate slots for next 30 days
    try {
      const padelCourts = await this.padelRepo.find({
        where: { isActive: true, courtStatus: 'active' },
        select: ['id', 'tenantId', 'timeSlotTemplateId'],
      });

      const turfCourts = await this.turfRepo.find({
        where: { status: 'active' },
        select: ['id', 'tenantId', 'timeSlotTemplateId'],
      });

      const tableTennisCourts = await this.tableTennisRepo.find({
        where: { isActive: true, courtStatus: 'active' },
        select: ['id', 'tenantId', 'timeSlotTemplateId'],
      });

      const datesToGenerate = this.getRollingZonedDateStrings(30);

      let totalUpserted = 0;

      // Process Padel Courts (template optional — service falls back to default grid)
      for (const court of padelCourts) {
        for (const date of datesToGenerate) {
          try {
            const res = await this.bookingsService.generateDayFacilitySlots(
              court.tenantId,
              {
                kind: 'padel_court',
                courtId: court.id,
                date,
              },
            );
            totalUpserted += res.upserted;
          } catch (slotErr) {
            this.logger.error(
              `Failed to generate slots for Padel court ${court.id} on ${date}`,
              slotErr,
            );
          }
        }
      }

      // Process Turf Courts
      for (const court of turfCourts) {
        for (const date of datesToGenerate) {
          try {
            const res = await this.bookingsService.generateDayFacilitySlots(
              court.tenantId,
              {
                kind: 'turf_court',
                courtId: court.id,
                date,
              },
            );
            totalUpserted += res.upserted;
          } catch (slotErr) {
            this.logger.error(
              `Failed to generate slots for Turf court ${court.id} on ${date}`,
              slotErr,
            );
          }
        }
      }

      for (const court of tableTennisCourts) {
        for (const date of datesToGenerate) {
          try {
            const res = await this.bookingsService.generateDayFacilitySlots(
              court.tenantId,
              {
                kind: 'table_tennis_court',
                courtId: court.id,
                date,
              },
            );
            totalUpserted += res.upserted;
          } catch (slotErr) {
            this.logger.error(
              `Failed to generate slots for table tennis table ${court.id} on ${date}`,
              slotErr,
            );
          }
        }
      }

      this.logger.log(
        `Finished slot generation. Total slots processed/upserted: ${totalUpserted}`,
      );
    } catch (err) {
      this.logger.error('Failed during slot generation loop', err);
    }

    this.logger.log('Daily slot maintenance task completed.');
  }

  /**
   * Run every 10 minutes to auto-cancel unstarted bookings past their slot end.
   * Live bookings past end stay live (overtime) until checkout.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleBookingCompletion() {
    this.logger.log('Starting booking completion task...');
    try {
      await this.bookingsService.completePastBookings();
    } catch (err) {
      this.logger.error('Failed to complete past bookings', err);
    }
  }

  /**
   * Run every 10 minutes to:
   * Delete expired facility slots for both past days and elapsed time today.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleExpiredFacilitySlotCleanup() {
    this.logger.log('Starting expired facility slot cleanup task...');
    try {
      await this.cleanupPastFacilitySlots(true);
    } catch (err) {
      this.logger.error('Failed expired facility slot cleanup', err);
    }
  }
}
