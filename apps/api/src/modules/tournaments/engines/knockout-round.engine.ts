import { resolveMatchWinner } from './knockout-result.engine';

export type KnockoutNodeLike = {
  round: number;
  slotIndex: number;
  matchId?: string | null;
  isBye: boolean;
  teamId?: string | null;
  awayTeamId?: string | null;
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
  if (feeder.isBye && feeder.teamId?.trim()) return feeder.teamId.trim();
  if (!feeder.matchId) {
    return feeder.teamId?.trim() || null;
  }
  const match = matchById.get(feeder.matchId);
  if (!match) return null;
  return resolveMatchWinner(match);
}

export function collectRoundWinners(
  round: number,
  nodes: KnockoutNodeLike[],
  matchById: Map<string, KnockoutMatchLike>,
): string[] {
  const roundNodes = nodes
    .filter((n) => n.round === round)
    .sort((a, b) => a.slotIndex - b.slotIndex);
  const winners: string[] = [];
  for (const node of roundNodes) {
    if (node.matchId) {
      const winner = resolveKnockoutFeederTeam(node, matchById);
      if (winner) winners.push(winner);
      continue;
    }
    if (node.isBye && node.teamId?.trim()) {
      winners.push(node.teamId.trim());
      continue;
    }
    if (node.teamId?.trim() && !node.awayTeamId) {
      winners.push(node.teamId.trim());
    }
  }
  return winners;
}

export function isKnockoutRoundComplete(
  round: number,
  nodes: KnockoutNodeLike[],
  matchById: Map<string, KnockoutMatchLike>,
): boolean {
  const roundNodes = nodes.filter((n) => n.round === round);
  if (roundNodes.length === 0) return false;
  for (const node of roundNodes) {
    if (!node.matchId) {
      if (node.isBye && node.teamId?.trim()) continue;
      if (node.teamId?.trim() && !node.awayTeamId) continue;
      return false;
    }
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
  if (!isKnockoutRoundComplete(maxRound, nodes, matchById)) return null;
  const winners = collectRoundWinners(maxRound, nodes, matchById);
  if (winners.length <= 1) return null;
  return maxRound + 1;
}

export function isKnockoutBracketFullyResolved(
  nodes: KnockoutNodeLike[],
  matchById: Map<string, KnockoutMatchLike>,
): boolean {
  if (nodes.length === 0) return false;
  const maxRound = Math.max(...nodes.map((n) => n.round));
  if (!isKnockoutRoundComplete(maxRound, nodes, matchById)) return false;
  return collectRoundWinners(maxRound, nodes, matchById).length === 1;
}

export function buildNextRoundPairings(
  winners: string[],
  byeTeamIds: ReadonlySet<string> = new Set(),
): {
  matches: { homeTeamId: string; awayTeamId: string }[];
  carryTeamId: string | null;
} {
  if (winners.length === 3) {
    const carry = winners.find((id) => byeTeamIds.has(id)) ?? winners[0];
    const play = winners.filter((id) => id !== carry);
    return {
      matches: [{ homeTeamId: play[0], awayTeamId: play[1] }],
      carryTeamId: carry,
    };
  }

  const matches: { homeTeamId: string; awayTeamId: string }[] = [];
  const pairable = winners.length % 2 === 0 ? winners : winners.slice(0, -1);
  for (let i = 0; i + 1 < pairable.length; i += 2) {
    matches.push({
      homeTeamId: pairable[i],
      awayTeamId: pairable[i + 1],
    });
  }
  const carryTeamId =
    winners.length % 2 === 1 ? winners[winners.length - 1] : null;
  return { matches, carryTeamId };
}
