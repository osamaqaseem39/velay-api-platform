import type { CourtKind } from '../types/booking.types';
import { BOOKING_SPORT_TYPES } from '../types/booking.types';
import type { Booking } from '../entities/booking.entity';
import type { BookingItem } from '../entities/booking-item.entity';

/** Offset suffix for `Date.parse` (expand as venues grow). */
const IANA_TO_UTC_OFFSET: Record<string, string> = {
  'Asia/Karachi': '+05:00',
  'Asia/Dubai': '+04:00',
  'UTC': 'Z',
  'Etc/UTC': 'Z',
};

function offsetSuffixForTimeZone(tz: string | null | undefined): string {
  const t = (tz || '').trim();
  if (!t) return '+05:00';
  return IANA_TO_UTC_OFFSET[t] ?? '+05:00';
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function timeToMins(t: string): number {
  const s = (t || '').trim();
  if (s === '24:00' || s === '24:00:00') return 24 * 60;
  const [h, m] = s.split(':').map((x) => Number(x || 0));
  return h * 60 + m;
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Interprets `ymd` + `hh:mm` in the business location’s wall clock using a fixed offset map.
 */
export function wallRangeToMs(
  ymd: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): { startMs: number; endMs: number } {
  const off = offsetSuffixForTimeZone(timeZone);
  const st = (startTime || '').length === 5 ? `${startTime}:00` : startTime;
  const startMs = Date.parse(`${ymd}T${st}${off}`);
  let endYmd = ymd;
  let et = endTime;
  if (timeToMins(et) <= timeToMins(startTime)) {
    endYmd = addDaysYmd(ymd, 1);
  }
  const endPart = (et || '').length === 5 ? `${et}:00` : et;
  const endMs = Date.parse(`${endYmd}T${endPart}${off}`);
  return { startMs, endMs };
}

export function ymdInTimeZone(tz: string, d = new Date()): string {
  const id = (tz || '').trim() || 'Asia/Karachi';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: id,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function resolveTimeZoneId(raw: string | null | undefined): string {
  const t = (raw || '').trim();
  if (t && t in IANA_TO_UTC_OFFSET) return t;
  return 'Asia/Karachi';
}

function itemBookingYmd(booking: Booking, item: BookingItem): string {
  const raw = item.date ?? booking.bookingDate;
  if (raw == null || raw === '') return '';
  return String(raw).trim().split('T')[0] ?? '';
}

/**
 * True when `now` falls inside any non-cancelled item window, in the venue wall clock.
 * Used to expose `BookingViewStatus` `"live"` without persisting it.
 */
export function bookingIsInPlayWindowNow(
  booking: Booking,
  locationTimeZone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const status = booking.bookingStatus;
  if (
    status === 'cancelled' ||
    status === 'no_show' ||
    status === 'completed'
  ) {
    return false;
  }
  if (status !== 'confirmed') return false;

  const tz = resolveTimeZoneId(locationTimeZone);
  const nowMs = now.getTime();
  for (const it of booking.items || []) {
    if (it.itemStatus === 'cancelled') continue;
    const ymd = itemBookingYmd(booking, it);
    if (!ymd) continue;
    const { startMs, endMs } = wallRangeToMs(
      ymd,
      it.startTime,
      it.endTime,
      tz,
    );
    if (startMs <= nowMs && nowMs < endMs) return true;
  }
  return false;
}

export type FacilityPlayStatus = 'inactive' | 'live' | 'soon' | 'idle' | 'overtime';

function numFromDecLike(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  // DB decimals have scale=2; keep a stable 2-dec representation for clients.
  return Math.round(n * 100) / 100;
}

export type LiveBookingRef = {
  bookingId: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  /** Full booking total, not segment price. */
  totalAmount: number;
  /** Booking pricing discount (PKR). */
  discount: number;
  /** Remaining payable amount = totalAmount - paidAmount. */
  remainingAmount: number;
  sportType: string;
  userDisplayName?: string;
};

function userDisplayName(u: Booking['user'] | undefined | null): string | undefined {
  if (!u) return undefined;
  const n = (u as { fullName?: string })?.fullName?.trim();
  if (n) return n;
  return (u as { email?: string })?.email || undefined;
}

type ItemW = { booking: Booking; item: BookingItem; startMs: number; endMs: number };

function collectItemWindows(
  bookings: Booking[],
  courtKind: CourtKind,
  courtId: string,
  timeZone: string,
): ItemW[] {
  const out: ItemW[] = [];
  for (const b of bookings) {
    if (
      b.bookingStatus === 'cancelled' ||
      b.bookingStatus === 'no_show' ||
      b.bookingStatus === 'completed'
    ) {
      continue;
    }
    for (const it of b.items || []) {
      if (it.courtId !== courtId) continue;
      if (it.courtKind !== courtKind) continue;
      if (it.itemStatus === 'cancelled') continue;
      const ymd = itemBookingYmd(b, it);
      if (!ymd) continue;
      const { startMs, endMs } = wallRangeToMs(ymd, it.startTime, it.endTime, timeZone);
      out.push({ booking: b, item: it, startMs, endMs });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

function hoursBetween(a: number, b: number): number {
  return Math.max(0, (b - a) / (1000 * 60 * 60));
}

const SOON_MS = 60 * 60 * 1000;

/** Min/max wall window for this booking on this court (all non-cancelled segments). */
function sessionWindowOnCourt(
  b: Booking,
  courtKind: CourtKind,
  courtId: string,
  timeZone: string,
): { startMs: number; endMs: number; startTime: string; endTime: string } | null {
  const tz = resolveTimeZoneId(timeZone);
  let minS = Number.POSITIVE_INFINITY;
  let maxE = Number.NEGATIVE_INFINITY;
  let startTime = '';
  let endTime = '';
  for (const it of b.items || []) {
    if (it.courtId !== courtId || it.courtKind !== courtKind) continue;
    if (it.itemStatus === 'cancelled') continue;
    const ymd = itemBookingYmd(b, it);
    if (!ymd) continue;
    const { startMs, endMs } = wallRangeToMs(ymd, it.startTime, it.endTime, tz);
    if (startMs < minS) {
      minS = startMs;
      startTime = it.startTime;
    }
    if (endMs > maxE) {
      maxE = endMs;
      endTime = it.endTime;
    }
  }
  if (!startTime || !Number.isFinite(minS) || maxE <= minS) return null;
  return { startMs: minS, endMs: maxE, startTime, endTime };
}

function liveRefFromSessionWindow(
  b: Booking,
  w: { startTime: string; endTime: string },
): LiveBookingRef {
  const st = String(b.sportType || 'futsal').toLowerCase();
  const totalAmount = numFromDecLike(b.totalAmount);
  const discount = numFromDecLike(b.discount);
  const paidAmount = numFromDecLike(b.paidAmount);
  const remainingAmount = Math.max(0, Number((totalAmount - paidAmount).toFixed(2)));
  return {
    bookingId: b.id,
    bookingDate: b.bookingDate,
    startTime: w.startTime,
    endTime: w.endTime,
    totalAmount,
    discount,
    remainingAmount,
    sportType: (BOOKING_SPORT_TYPES as readonly string[]).includes(st)
      ? st
      : 'futsal',
    userDisplayName: userDisplayName(b.user),
  };
}

export type FacilityPlaySnapshot = {
  courtKind: CourtKind;
  courtId: string;
  name: string;
  playStatus: FacilityPlayStatus;
  currentBooking: LiveBookingRef | null;
  currentEndsAt: string | null;
  nextBooking: LiveBookingRef | null;
  nextStartsAt: string | null;
  minutesUntilNext: number | null;
  hoursBookedToday: number;
  hoursBookedLast7Days: number;
};

export function buildPlaySnapshot(
  bookings: Booking[],
  courtKind: CourtKind,
  courtId: string,
  name: string,
  opts: {
    timeZone: string;
    now?: Date;
    /** Padel: courtStatus / active. Turf: status. */
    facilityActive: boolean;
    /** maintenance | inactive / … */
    statusRaw: string;
  },
): FacilityPlaySnapshot {
  const now = (opts.now ?? new Date()).getTime();
  const tz = resolveTimeZoneId(opts.timeZone);
  const status = (opts.statusRaw || '').toLowerCase();
  const inactive =
    !opts.facilityActive ||
    status === 'maintenance' ||
    status === 'inactive';

  if (inactive) {
    return {
      courtKind,
      courtId,
      name,
      playStatus: 'inactive',
      currentBooking: null,
      currentEndsAt: null,
      nextBooking: null,
      nextStartsAt: null,
      minutesUntilNext: null,
      hoursBookedToday: 0,
      hoursBookedLast7Days: 0,
    };
  }

  const todayYmd = ymdInTimeZone(tz, new Date(now));
  const weekYmds = new Set<string>();
  for (let i = 0; i < 7; i++) {
    weekYmds.add(addDaysYmd(todayYmd, -i));
  }

  const windows = collectItemWindows(bookings, courtKind, courtId, tz);
  let hoursBookedToday = 0;
  let hoursBookedLast7Days = 0;
  for (const w of windows) {
    const h = hoursBetween(w.startMs, w.endMs);
    const dayKey = ymdInTimeZone(tz, new Date(w.startMs));
    if (dayKey === todayYmd) {
      hoursBookedToday += h;
    }
    if (weekYmds.has(dayKey)) {
      hoursBookedLast7Days += h;
    }
  }

  // Only expose a booking as `currentBooking` when it is explicitly marked `live`.
  // Time-window math alone is not sufficient (bookings may still be `confirmed` until the venue flips them to `live`).
  const ongoing =
    windows.find((w) => w.startMs <= now && now < w.endMs && w.booking.bookingStatus === 'live') ?? null;

  type SessionWindow = NonNullable<ReturnType<typeof sessionWindowOnCourt>>;

  // If a booking is still marked `live` but its session window has already ended, treat it as `overtime`.
  const overtime = (() => {
    const liveBookings = Array.from(
      new Map(
        windows
          .filter((w) => w.booking.bookingStatus === 'live')
          .map((w) => [w.booking.id, w.booking] as const),
      ).values(),
    );

    let best: { booking: Booking; sw: SessionWindow } | null = null;

    for (const b of liveBookings) {
      const sw = sessionWindowOnCourt(b, courtKind, courtId, tz);
      if (!sw) continue;
      if (sw.endMs > now) continue; // still within session window
      if (!best || sw.endMs > best.sw.endMs) best = { booking: b, sw };
    }

    return best;
  })();

  // If a booking time-window has already started but it's still not marked `live`,
  // keep it visible in `nextBooking` until the venue flips it.
  const startedButNotLive = windows
    .filter((w) => w.startMs <= now && now < w.endMs && w.booking.bookingStatus !== 'live')
    .sort((a, b) => a.startMs - b.startMs);

  const future = windows
    .filter((w) => w.startMs > now)
    .sort((a, b) => a.startMs - b.startMs);

  const currentLiveBooking = ongoing ? ongoing.booking : overtime?.booking ?? null;

  const next = currentLiveBooking
    ? future.find((w) => w.booking.id !== currentLiveBooking.id) ?? null
    : startedButNotLive[0] ?? future[0] ?? null;

  let playStatus: FacilityPlayStatus = 'idle';
  if (ongoing) {
    playStatus = 'live';
  } else if (overtime) {
    playStatus = 'overtime';
  } else if (next) {
    const ms = next.startMs - now;
    if (ms >= 0 && ms <= SOON_MS) {
      playStatus = 'soon';
    }
  }

  const ongoingSw = ongoing
    ? sessionWindowOnCourt(ongoing.booking, courtKind, courtId, tz)
    : null;
  const overtimeSw = overtime?.sw ?? null;
  const currentSw = ongoing ? ongoingSw : overtimeSw;
  const nextSw = next
    ? sessionWindowOnCourt(next.booking, courtKind, courtId, tz)
    : null;

  return {
    courtKind,
    courtId,
    name,
    playStatus,
    currentBooking:
      ongoing && ongoingSw
        ? liveRefFromSessionWindow(ongoing.booking, ongoingSw)
        : overtime && overtimeSw
          ? liveRefFromSessionWindow(overtime.booking, overtimeSw)
          : null,
    currentEndsAt: currentSw ? new Date(currentSw.endMs).toISOString() : null,
    nextBooking: next && nextSw ? liveRefFromSessionWindow(next.booking, nextSw) : null,
    nextStartsAt: next ? new Date(next.startMs).toISOString() : null,
    minutesUntilNext:
      next && next.startMs > now
        ? Math.round((next.startMs - now) / 60000)
        : null,
    hoursBookedToday: Math.round(hoursBookedToday * 10) / 10,
    hoursBookedLast7Days: Math.round(hoursBookedLast7Days * 10) / 10,
  };
}
