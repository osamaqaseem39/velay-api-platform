import type { CourtKind } from '../../bookings/types/booking.types';
import type { BookingSportType } from '../../bookings/types/booking.types';

const COURT_KIND_ALIASES: Record<string, CourtKind> = {
  'padel-court': 'padel_court',
  padel_court: 'padel_court',
  'turf-court': 'turf_court',
  turf_court: 'turf_court',
  'table-tennis-court': 'table_tennis_court',
  table_tennis_court: 'table_tennis_court',
};

export function normalizeCourtKind(raw?: string | null): CourtKind | null {
  if (!raw?.trim()) return null;
  return COURT_KIND_ALIASES[raw.trim()] ?? null;
}

export function sportTypeForCourtKind(kind: CourtKind): BookingSportType {
  if (kind === 'padel_court') return 'padel';
  if (kind === 'table_tennis_court') return 'table-tennis';
  return 'futsal';
}
