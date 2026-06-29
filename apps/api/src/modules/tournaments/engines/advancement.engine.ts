import type { StandingsRules } from '../types/tournament.types';
import {
  computeStandings,
  type MatchResultInput,
  type StandingRow,
} from './standings.engine';

export type GroupStandingInput = {
  groupId: string;
  groupName: string;
  teamIds: string[];
  results: MatchResultInput[];
  rules: StandingsRules;
};

export function pickAdvancingTeams(
  groups: GroupStandingInput[],
  advancement?: Record<string, unknown>,
): string[] {
  const topN = Math.max(1, Number(advancement?.topNPerGroup ?? 2));
  const bestThird = Math.max(0, Number(advancement?.bestThirdPlace ?? 0));
  const sortedGroups = [...groups].sort((a, b) =>
    a.groupName.localeCompare(b.groupName),
  );
  const perGroup: string[][] = [];
  const thirdPlace: StandingRow[] = [];

  for (const g of sortedGroups) {
    const rows = computeStandings(g.teamIds, g.results, g.rules);
    const picked: string[] = [];
    for (let i = 0; i < topN && i < rows.length; i++) {
      picked.push(rows[i].teamId);
    }
    perGroup.push(picked);
    if (bestThird > 0 && rows.length > topN) {
      thirdPlace.push(rows[topN]);
    }
  }

  const advanced: string[] = [];
  const maxRank = perGroup.reduce((max, groupTeams) => {
    return Math.max(max, groupTeams.length);
  }, 0);
  for (let rank = 0; rank < maxRank; rank++) {
    for (const groupTeams of perGroup) {
      if (rank < groupTeams.length) {
        advanced.push(groupTeams[rank]);
      }
    }
  }

  if (bestThird > 0 && thirdPlace.length > 0) {
    thirdPlace.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const gdA = a.goalsFor - a.goalsAgainst;
      const gdB = b.goalsFor - b.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.teamId.localeCompare(b.teamId);
    });
    for (let i = 0; i < bestThird && i < thirdPlace.length; i++) {
      const tid = thirdPlace[i].teamId;
      if (!advanced.includes(tid)) advanced.push(tid);
    }
  }

  return advanced;
}
