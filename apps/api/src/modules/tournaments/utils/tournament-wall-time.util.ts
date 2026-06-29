import {
  resolveTimeZoneId,
  ymdInTimeZone,
} from '../../bookings/utils/facility-live-snapshot.util';

function wallPartsInTimeZone(
  tz: string,
  d: Date,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZoneId(tz),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toBookingWallWindow(
  scheduledAt: Date,
  durationMinutes: number,
  timeZone?: string | null,
): { bookingDate: string; startTime: string; endTime: string } {
  const tz = resolveTimeZoneId(timeZone);
  const bookingDate = ymdInTimeZone(tz, scheduledAt);
  const start = wallPartsInTimeZone(tz, scheduledAt);
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  const end = wallPartsInTimeZone(tz, endAt);
  const startTime = `${pad2(start.hour)}:${pad2(start.minute)}`;
  let endTime = `${pad2(end.hour)}:${pad2(end.minute)}`;
  if (endTime === '00:00' && durationMinutes > 0) endTime = '24:00';
  return { bookingDate, startTime, endTime };
}
