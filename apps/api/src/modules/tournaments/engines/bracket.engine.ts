export type BracketNodeDraft = {
  round: number;
  slotIndex: number;
  parentNodeId?: string;
  parentRound?: number;
  parentSlotIndex?: number;
  teamId?: string;
  awayTeamId?: string;
  isBye: boolean;
  winnerAdvancesToNodeId?: string;
};

export function log2(n: number): number {
  return Math.log2(n);
}

export function knockoutRoundCount(teamCount: number): number {
  if (teamCount < 2) return 0;
  return Math.ceil(Math.log2(teamCount));
}

export function knockoutByeCount(teamCount: number): number {
  return teamCount > 0 && teamCount % 2 === 1 ? 1 : 0;
}

export function pairConsecutiveTeams(
  teamIds: string[],
): { homeTeamId: string; awayTeamId: string }[] {
  const pairs: { homeTeamId: string; awayTeamId: string }[] = [];
  for (let i = 0; i + 1 < teamIds.length; i += 2) {
    pairs.push({ homeTeamId: teamIds[i], awayTeamId: teamIds[i + 1] });
  }
  return pairs;
}

export function generateKnockoutBracket(
  teamIds: string[],
  _bracketSize?: number,
): BracketNodeDraft[] {
  const n = teamIds.length;
  if (n < 2) return [];

  const nodes: BracketNodeDraft[] = [];

  if (n % 2 === 1) {
    const pairs = pairConsecutiveTeams(teamIds.slice(1));
    for (let i = 0; i < pairs.length; i++) {
      nodes.push({
        round: 1,
        slotIndex: i,
        teamId: pairs[i].homeTeamId,
        awayTeamId: pairs[i].awayTeamId,
        isBye: false,
      });
    }
    nodes.push({
      round: 1,
      slotIndex: pairs.length,
      teamId: teamIds[0],
      isBye: true,
    });
    return nodes;
  }

  const pairs = pairConsecutiveTeams(teamIds);
  return pairs.map((pair, slotIndex) => ({
    round: 1,
    slotIndex,
    teamId: pair.homeTeamId,
    awayTeamId: pair.awayTeamId,
    isBye: false,
  }));
}
