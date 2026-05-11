import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import type { CreateTimeSlotTemplateDto } from '../dto/create-time-slot-template.dto';
import type { UpdateTimeSlotTemplateDto } from '../dto/update-time-slot-template.dto';
import { TenantTimeSlotTemplate } from '../entities/tenant-time-slot-template.entity';
import { TenantTimeSlotTemplateLine } from '../entities/tenant-time-slot-template-line.entity';
import { PadelCourt } from '../../arena/padel-court/entities/padel-court.entity';
import { TableTennisCourt } from '../../arena/table-tennis-court/entities/table-tennis-court.entity';
import { TurfCourt } from '../../arena/turf/entities/turf-court.entity';
import { CourtFacilitySlot } from '../entities/court-facility-slot.entity';
import { BookingItem } from '../entities/booking-item.entity';

function toMinutes(time: string, isEndTime = false): number {
  if (time === '24:00' || (time === '00:00' && isEndTime)) return 24 * 60;
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw || 0);
  const m = Number(mRaw || 0);
  return h * 60 + m;
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export type TimeSlotTemplateApiRow = {
  id: string;
  name: string;
  slotLines: Array<{
    id: string;
    startTime: string;
    endTime: string;
    status: 'available' | 'blocked';
    sortOrder: number;
  }>;
  slotStarts: string[];
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class TimeSlotTemplatesService {
  private static readonly FACILITY_SLOT_INSERT_BATCH_SIZE = 2000;

  constructor(
    @InjectRepository(TenantTimeSlotTemplate)
    private readonly templateRepo: Repository<TenantTimeSlotTemplate>,
    @InjectRepository(TenantTimeSlotTemplateLine)
    private readonly lineRepo: Repository<TenantTimeSlotTemplateLine>,
    @InjectRepository(PadelCourt)
    private readonly padelRepo: Repository<PadelCourt>,
    @InjectRepository(TurfCourt)
    private readonly turfRepo: Repository<TurfCourt>,
    @InjectRepository(TableTennisCourt)
    private readonly tableTennisRepo: Repository<TableTennisCourt>,
    @InjectRepository(CourtFacilitySlot)
    private readonly facilitySlotRepo: Repository<CourtFacilitySlot>,
    @InjectRepository(BookingItem)
    private readonly bookingItemRepo: Repository<BookingItem>,
  ) {}

  private async syncTemplateToFacilitySlots(
    tenantId: string,
    templateId: string,
    slotLines: TenantTimeSlotTemplateLine[],
  ): Promise<void> {
    const [padelCourts, turfCourts, tableTennisCourts] = await Promise.all([
      this.padelRepo.find({
        where: { tenantId, timeSlotTemplateId: templateId },
        select: ['id'],
      }),
      this.turfRepo.find({
        where: { tenantId, timeSlotTemplateId: templateId },
        select: ['id'],
      }),
      this.tableTennisRepo.find({
        where: { tenantId, timeSlotTemplateId: templateId },
        select: ['id'],
      }),
    ]);

    const padelCourtIds = padelCourts.map((c) => c.id);
    const turfCourtIds = turfCourts.map((c) => c.id);
    const tableTennisIds = tableTennisCourts.map((c) => c.id);
    if (!padelCourtIds.length && !turfCourtIds.length && !tableTennisIds.length)
      return;

    const today = new Date().toISOString().slice(0, 10);
    const dates: string[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    if (padelCourtIds.length) {
      await this.facilitySlotRepo.delete({
        tenantId,
        courtKind: 'padel_court',
        courtId: In(padelCourtIds),
        slotDate: MoreThanOrEqual(today),
      });
    }
    if (turfCourtIds.length) {
      await this.facilitySlotRepo.delete({
        tenantId,
        courtKind: 'turf_court',
        courtId: In(turfCourtIds),
        slotDate: MoreThanOrEqual(today),
      });
    }
    if (tableTennisIds.length) {
      await this.facilitySlotRepo.delete({
        tenantId,
        courtKind: 'table_tennis_court',
        courtId: In(tableTennisIds),
        slotDate: MoreThanOrEqual(today),
      });
    }

    if (!slotLines.length) return;

    const values: CourtFacilitySlot[] = [];
    for (const slotDate of dates) {
      for (const line of slotLines) {
        for (const courtId of padelCourtIds) {
          values.push(
            this.facilitySlotRepo.create({
              tenantId,
              courtKind: 'padel_court',
              courtId,
              slotDate,
              startTime: line.startTime,
              endTime: line.endTime,
              status: line.status,
            }),
          );
        }
        for (const courtId of turfCourtIds) {
          values.push(
            this.facilitySlotRepo.create({
              tenantId,
              courtKind: 'turf_court',
              courtId,
              slotDate,
              startTime: line.startTime,
              endTime: line.endTime,
              status: line.status,
            }),
          );
        }
        for (const courtId of tableTennisIds) {
          values.push(
            this.facilitySlotRepo.create({
              tenantId,
              courtKind: 'table_tennis_court',
              courtId,
              slotDate,
              startTime: line.startTime,
              endTime: line.endTime,
              status: line.status,
            }),
          );
        }
      }
    }

    if (values.length) {
      const batchSize = TimeSlotTemplatesService.FACILITY_SLOT_INSERT_BATCH_SIZE;
      for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        await this.facilitySlotRepo.insert(batch);
      }
    }

    const affectedCourtIds = [
      ...padelCourtIds,
      ...turfCourtIds,
      ...tableTennisIds,
    ];
    if (!affectedCourtIds.length) return;

    const activeBookingItems = await this.bookingItemRepo
      .createQueryBuilder('item')
      .innerJoin('item.booking', 'booking')
      .where('item.tenantId = :tenantId', { tenantId })
      .andWhere('item.courtId IN (:...courtIds)', {
        courtIds: affectedCourtIds,
      })
      .andWhere("booking.bookingStatus IN ('confirmed', 'pending', 'live', 'completed')")
      .andWhere("item.itemStatus <> 'cancelled'")
      .andWhere('item.endDatetime >= :startDateTime', {
        startDateTime: `${today}T00:00:00.000Z`,
      })
      .select([
        'item.courtKind AS "courtKind"',
        'item.courtId AS "courtId"',
        'item.startDatetime AS "startDatetime"',
        'item.endDatetime AS "endDatetime"',
      ])
      .getRawMany<{
        courtKind: 'padel_court' | 'turf_court' | 'table_tennis_court';
        courtId: string;
        startDatetime: string;
        endDatetime: string;
      }>();

    for (const item of activeBookingItems) {
      const startIso = new Date(item.startDatetime);
      const endIso = new Date(item.endDatetime);
      const startDate = startIso.toISOString().slice(0, 10);
      const endDate = endIso.toISOString().slice(0, 10);
      const touchedDates = new Set<string>([startDate, endDate]);

      for (const slotDate of touchedDates) {
        const windowStart =
          slotDate === startDate ? startIso.toISOString().slice(11, 16) : '00:00';
        const windowEnd =
          slotDate === endDate ? endIso.toISOString().slice(11, 16) : '24:00';
        const effectiveEnd = windowEnd === '00:00' ? '24:00' : windowEnd;

        await this.facilitySlotRepo
          .createQueryBuilder()
          .update(CourtFacilitySlot)
          .set({ status: 'blocked' })
          .where('tenantId = :tenantId', { tenantId })
          .andWhere('courtKind = :courtKind', { courtKind: item.courtKind })
          .andWhere('courtId = :courtId', { courtId: item.courtId })
          .andWhere('slotDate = :slotDate', { slotDate })
          .andWhere('startTime < :endTime', { endTime: effectiveEnd })
          .andWhere('endTime > :startTime', { startTime: windowStart })
          .execute();
      }
    }
  }

  private normalizeSlotStarts(raw: string[]): string[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const s of raw) {
      const t = String(s).trim();
      if (!t) continue;
      const m = toMinutes(t, false);
      if (m < 0 || m >= 24 * 60) {
        throw new BadRequestException(`Invalid slot start time: ${t}`);
      }
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
    out.sort((a, b) => a - b);
    if (!out.length) {
      throw new BadRequestException(
        'At least one valid slot start is required',
      );
    }
    return out.map(minutesToLabel);
  }

  private normalizeSlotLines(
    dto: CreateTimeSlotTemplateDto | UpdateTimeSlotTemplateDto,
  ): Array<{
    startTime: string;
    endTime: string;
    status: 'available' | 'blocked';
    sortOrder: number;
  }> {
    const hasLines = Array.isArray(dto.slotLines);
    const hasStarts = Array.isArray(dto.slotStarts);
    if (!hasLines && !hasStarts) {
      throw new BadRequestException(
        'Either slotLines or slotStarts is required',
      );
    }
    if (hasLines) {
      const rows: Array<{
        startTime: string;
        endTime: string;
        status: 'available' | 'blocked';
        sortOrder: number;
      }> = (dto.slotLines ?? []).map((line, idx) => {
        const startTime = String(line.startTime ?? '').trim();
        const endTime = String(line.endTime ?? '').trim();
        if (!startTime || !endTime) {
          throw new BadRequestException(
            'Each slot line requires startTime and endTime',
          );
        }
        const startMin = toMinutes(startTime, false);
        const endMin = toMinutes(endTime, true);
        if (
          startMin < 0 ||
          startMin >= 24 * 60 ||
          endMin <= 0 ||
          endMin > 24 * 60
        ) {
          throw new BadRequestException(
            `Invalid slot line time range: ${startTime}-${endTime}`,
          );
        }
        if (endMin <= startMin) {
          throw new BadRequestException(
            `slot line endTime must be after startTime: ${startTime}`,
          );
        }
        const status: 'available' | 'blocked' =
          line.status === 'blocked' ? 'blocked' : 'available';
        return {
          startTime: minutesToLabel(startMin),
          endTime: minutesToLabel(endMin),
          status,
          sortOrder: idx + 1,
        };
      });
      const seenStarts = new Set<string>();
      for (const row of rows) {
        if (seenStarts.has(row.startTime)) {
          throw new BadRequestException(
            `Duplicate slot line startTime is not allowed: ${row.startTime}`,
          );
        }
        seenStarts.add(row.startTime);
      }
      if (!rows.length) {
        throw new BadRequestException(
          'At least one valid slot line is required',
        );
      }
      return rows;
    }
    const starts = this.normalizeSlotStarts(dto.slotStarts ?? []);
    const startMinutes = starts.map((s) => toMinutes(s, false));
    const diffs = startMinutes
      .slice(1)
      .map((m, idx) => m - startMinutes[idx])
      .filter((d) => d > 0);
    if (diffs.length === 0) {
      throw new BadRequestException(
        'When using slotStarts, provide at least two starts or use slotLines with explicit endTime',
      );
    }
    const inferredDuration = Math.min(...diffs);
    return starts.map((startTime, idx) => {
      const start = toMinutes(startTime, false);
      const nextStart = startMinutes[idx + 1];
      const end = nextStart ?? start + inferredDuration;
      if (end <= start || end > 24 * 60) {
        throw new BadRequestException(
          `Could not infer valid endTime for slot start ${startTime}`,
        );
      }
      return {
        startTime,
        endTime: minutesToLabel(end),
        status: 'available' as const,
        sortOrder: idx + 1,
      };
    });
  }

  async assertBelongsToTenant(
    tenantId: string,
    templateId: string,
  ): Promise<TenantTimeSlotTemplate> {
    const row = await this.templateRepo.findOne({
      where: { id: templateId, tenantId },
    });
    if (!row) {
      throw new BadRequestException(
        'timeSlotTemplateId does not exist for this tenant',
      );
    }
    return row;
  }

  async list(tenantId: string): Promise<TimeSlotTemplateApiRow[]> {
    const rows = await this.templateRepo.find({
      where: { tenantId },
      relations: { slotLines: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => this.toApiRow(r));
  }

  async create(
    tenantId: string,
    dto: CreateTimeSlotTemplateDto,
  ): Promise<TimeSlotTemplateApiRow> {
    const slotLines = this.normalizeSlotLines(dto);
    const template = await this.templateRepo.save(
      this.templateRepo.create({
        tenantId,
        name: dto.name.trim(),
      }),
    );
    await this.lineRepo.save(
      slotLines.map((line) =>
        this.lineRepo.create({
          templateId: template.id,
          tenantId,
          startTime: line.startTime,
          endTime: line.endTime,
          status: line.status,
          sortOrder: line.sortOrder,
        }),
      ),
    );
    const saved = await this.templateRepo.findOne({
      where: { id: template.id, tenantId },
      relations: { slotLines: true },
    });
    if (!saved) throw new NotFoundException('Could not load saved template');
    return this.toApiRow(saved);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTimeSlotTemplateDto,
  ): Promise<TimeSlotTemplateApiRow> {
    const existing = await this.templateRepo.findOne({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Time slot template ${id} not found`);
    }
    const hasSlotDefinitionChanges =
      dto.slotLines !== undefined || dto.slotStarts !== undefined;

    await this.templateRepo.manager.transaction(async (tx) => {
      if (dto.name !== undefined) {
        await tx
          .getRepository(TenantTimeSlotTemplate)
          .update({ id, tenantId }, { name: dto.name.trim() });
      }
      if (hasSlotDefinitionChanges) {
        const lines = this.normalizeSlotLines(dto);
        await tx
          .getRepository(TenantTimeSlotTemplateLine)
          .delete({ templateId: id, tenantId });
        await tx.getRepository(TenantTimeSlotTemplateLine).insert(
          lines.map((line) => ({
            templateId: id,
            tenantId,
            startTime: line.startTime,
            endTime: line.endTime,
            status: line.status,
            sortOrder: line.sortOrder,
          })),
        );
      }
    });
    const saved = await this.templateRepo.findOne({
      where: { id, tenantId },
      relations: { slotLines: true },
    });
    if (!saved)
      throw new NotFoundException(`Time slot template ${id} not found`);

    if (hasSlotDefinitionChanges) {
      await this.syncTemplateToFacilitySlots(
        tenantId,
        id,
        (saved.slotLines ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder),
      );
    }

    return this.toApiRow(saved);
  }

  async remove(
    tenantId: string,
    id: string,
  ): Promise<{ deleted: true; id: string }> {
    const row = await this.templateRepo.findOne({ where: { id, tenantId } });
    if (!row) {
      throw new NotFoundException(`Time slot template ${id} not found`);
    }
    await this.templateRepo.remove(row);
    return { deleted: true, id };
  }

  private toApiRow(r: TenantTimeSlotTemplate): TimeSlotTemplateApiRow {
    const slotLines: TimeSlotTemplateApiRow['slotLines'] = (
      Array.isArray(r.slotLines) ? r.slotLines : []
    )
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        id: line.id,
        startTime: line.startTime,
        endTime: line.endTime,
        status: line.status === 'blocked' ? 'blocked' : 'available',
        sortOrder: line.sortOrder,
      }));
    return {
      id: r.id,
      name: r.name,
      slotLines,
      slotStarts: slotLines.map((line) => line.startTime),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
