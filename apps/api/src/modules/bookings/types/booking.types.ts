export const BOOKING_SPORT_TYPES = [
  'padel',
  'futsal',
  'cricket',
  'table-tennis',
] as const;
export type BookingSportType = (typeof BOOKING_SPORT_TYPES)[number];

export const BOOKING_ITEM_STATUSES = [
  'reserved',
  'confirmed',
  'cancelled',
] as const;
export type BookingItemStatus = (typeof BOOKING_ITEM_STATUSES)[number];

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'live',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BookingViewStatus = BookingStatus;

export const PAYMENT_STATUSES = [
  'pending',
  'partially_paid',
  'paid',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'jazzcash',
  'easypaisa',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Which physical court table `courtId` refers to */
export const COURT_KINDS = [
  'padel_court',
  'turf_court',
  'table_tennis_court',
] as const;

/** Booking calendar grid: slot grid, facility rows, blocks, and template starts use this step. */
export const COURT_SLOT_GRID_STEP_MINUTES = 60 as const;
export type CourtKind = (typeof COURT_KINDS)[number];
