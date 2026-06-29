import { ConflictException } from '@nestjs/common';
import { TOURNAMENT_ERROR_CODES } from '../types/tournament.types';
import type { MatchStatus, TournamentStatus } from '../types/tournament.types';

const TOURNAMENT_TRANSITIONS: Record<
  TournamentStatus,
  TournamentStatus[]
> = {
  pending_approval: ['draft', 'rejected', 'cancelled'],
  rejected: ['pending_approval', 'cancelled'],
  draft: ['published', 'cancelled'],
  published: ['registration_open', 'cancelled'],
  registration_open: ['registration_closed', 'cancelled'],
  registration_closed: ['ready', 'in_progress', 'cancelled'],
  ready: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: [],
};

const MATCH_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  draft: ['scheduled', 'walkover', 'cancelled'],
  scheduled: ['checked_in', 'in_progress', 'walkover', 'cancelled'],
  checked_in: ['in_progress', 'walkover', 'cancelled'],
  in_progress: ['completed', 'disputed', 'cancelled'],
  completed: ['approved', 'disputed', 'rejected'],
  disputed: ['approved', 'rejected'],
  walkover: ['approved'],
  approved: [],
  rejected: ['in_progress'],
  cancelled: [],
};

export function assertTournamentTransition(
  from: TournamentStatus,
  to: TournamentStatus,
): void {
  const allowed = TOURNAMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException({
      code: TOURNAMENT_ERROR_CODES.TOURNAMENT_INVALID_STATE,
      message: `Cannot transition tournament from ${from} to ${to}`,
    });
  }
}

export function assertMatchTransition(from: MatchStatus, to: MatchStatus): void {
  const allowed = MATCH_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictException({
      code: TOURNAMENT_ERROR_CODES.TOURNAMENT_INVALID_STATE,
      message: `Cannot transition match from ${from} to ${to}`,
    });
  }
}

export function getMatchStatusTransitions(from: MatchStatus): MatchStatus[] {
  return MATCH_TRANSITIONS[from] ?? [];
}

export function tournamentEventToStatus(
  event: string,
): TournamentStatus | null {
  const map: Record<string, TournamentStatus> = {
    publish: 'published',
    open_registration: 'registration_open',
    close_registration: 'registration_closed',
    mark_ready: 'ready',
    start: 'in_progress',
    complete: 'completed',
    reopen: 'in_progress',
    cancel: 'cancelled',
    approve: 'draft',
    reject: 'rejected',
    resubmit: 'pending_approval',
  };
  return map[event] ?? null;
}
