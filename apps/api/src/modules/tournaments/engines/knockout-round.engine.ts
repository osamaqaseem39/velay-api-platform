import { resolveMatchWinner } from './knockout-result.engine';

export type KnockoutNodeLike = {
  round: number;
  slotIndex: number;
  matchId?: string | null;
  isBye: boolean;
  teamId?: string | null;
};

export type KnockoutMatchLike = {
  id: string;
  status: string;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

const RESOLVED = new Set(['approved', 'walkover']);

export function resolveKnockoutFeederTeam(
  feeder: KnockoutNodeLike,
  matchById: Map<string, KnockoutMatchLike>,
): string | null {
  if (feeder.isBye && feeder.teamId) return feeder.teamId;
  if (!feeder.matchId) return null;
  const match = matchById.get(feeder.matchId);
  if (!match) return null;
  return resolveMatchWinner(match);
}

export function isKnockoutRoundComplete(
  round: number,
  nodes: KnockoutNodeLike[],
  matchById: Map<string, KnockoutMatchLike>,
): boolean {
  const roundNodes = nodes.filter((n) => n.round === round);
  if (roundNodes.length === 0) return false;
  for (const node of roundNodes) {
    if (node.isBye && node.teamId && !node.matchId) continue;
    if (!node.matchId) return false;
    const match = matchById.get(node.matchId);
    if (!match || !RESOLVED.has(match.status)) return false;
  }
  return true;
}

export function findNextKnockoutRoundToGenerate(
  nodes: KnockoutNodeLike[],
  matchById: Map<string, KnockoutMatchLike>,
): number | null {
  if (nodes.length === 0) return null;
  const maxRound = Math.max(...nodes.map((n) => n.round));
  for (let round = 2; round <= maxRound; round++) {
    const roundNodes = nodes.filter((n) => n.round === round);
    if (!roundNodes.some((n) => !n.matchId)) continue;
    if (!isKnockoutRoundComplete(round - 1, nodes, matchById)) return null;
    return round;
  }
  return null;
}
