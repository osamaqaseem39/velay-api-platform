export const TOURNAMENT_STRUCTURE_TYPES = [
  'direct_knockout',
  'group_only',
  'group_plus_knockout',
  'qualifier_group_knockout',
  'custom_multi_stage',
] as const;
export type TournamentStructureType =
  (typeof TOURNAMENT_STRUCTURE_TYPES)[number];

export const TOURNAMENT_STATUSES = [
  'pending_approval',
  'rejected',
  'draft',
  'published',
  'registration_open',
  'registration_closed',
  'ready',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const REGISTRATION_STATUSES = [
  'pending',
  'waitlisted',
  'approved',
  'rejected',
  'cancelled',
  'withdrawn',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const ACTIVE_REGISTRATION_STATUSES: RegistrationStatus[] = [
  'pending',
  'approved',
  'waitlisted',
];

export const MATCH_STATUSES = [
  'draft',
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'walkover',
  'disputed',
  'approved',
  'rejected',
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const STAGE_STATUSES = [
  'pending',
  'generating',
  'ready',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const SEEDING_MODES = [
  'random',
  'ranking',
  'manual',
  'protected',
] as const;
export type SeedingMode = (typeof SEEDING_MODES)[number];

export type StructureBlueprint = {
  teamCount: number;
  structureType: TournamentStructureType;
  groups?: { name: string; size: number }[];
  groupStage?: {
    rounds: number;
    matchesPerTeam?: number;
    groupCount?: number;
    minTeamsPerGroup?: number;
    maxTeamsPerGroup?: number;
  };
  knockout?: {
    bracketSize: number;
    byes: number;
    rounds: number;
  };
  advancement?: Record<string, unknown>;
  stages?: { order: number; name: string; stageType: string }[];
};

export type StandingsRules = {
  points: { win: number; draw: number; loss: number };
  tieBreakers: string[];
};

export const DEFAULT_STANDINGS_RULES: StandingsRules = {
  points: { win: 3, draw: 1, loss: 0 },
  tieBreakers: [
    'points',
    'goal_difference',
    'goals_for',
    'head_to_head',
    'wins',
    'random_draw',
  ],
};

export const TOURNAMENT_ERROR_CODES = {
  TOURNAMENT_INVALID_STATE: 'TOURNAMENT_INVALID_STATE',
  REGISTRATION_CLOSED: 'REGISTRATION_CLOSED',
  REGISTRATION_FULL: 'REGISTRATION_FULL',
  TEAM_ALREADY_REGISTERED: 'TEAM_ALREADY_REGISTERED',
  REGISTRATION_ALREADY_EXISTS: 'REGISTRATION_ALREADY_EXISTS',
  PAYMENT_NOT_CONFIRMED: 'PAYMENT_NOT_CONFIRMED',
  PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',
  MATCH_ALREADY_COMPLETED: 'MATCH_ALREADY_COMPLETED',
  INVALID_SCORE: 'INVALID_SCORE',
  INVALID_STAGE: 'INVALID_STAGE',
  STAGE_NOT_READY: 'STAGE_NOT_READY',
  BRACKET_LOCKED: 'BRACKET_LOCKED',
  COURT_CONFLICT: 'COURT_CONFLICT',
  CONFLICT_RETRY: 'CONFLICT_RETRY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  ADVANCEMENT_RULE_INVALID: 'ADVANCEMENT_RULE_INVALID',
} as const;
