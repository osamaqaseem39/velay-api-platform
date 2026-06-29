import type { StandingsRules } from '../types/tournament.types';

export type StandingRow = {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  rank?: number;
};

export type MatchResultInput = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
};

export function computeStandings(
  teamIds: string[],
  results: MatchResultInput[],
  rules: StandingsRules,
): StandingRow[] {
  const table = new Map<string, StandingRow>();
  for (const tid of teamIds) {
    table.set(tid, {
      teamId: tid,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    });
  }

  for (const m of results) {
    const home = table.get(m.homeTeamId);
    const away = table.get(m.awayTeamId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.goalsFor += m.homeScore;
    home.goalsAgainst += m.awayScore;
    away.goalsFor += m.awayScore;
    away.goalsAgainst += m.homeScore;

    if (m.homeScore > m.awayScore) {
      home.won++;
      away.lost++;
      home.points += rules.points.win;
      away.points += rules.points.loss;
    } else if (m.homeScore < m.awayScore) {
      away.won++;
      home.lost++;
      away.points += rules.points.win;
      home.points += rules.points.loss;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += rules.points.draw;
      away.points += rules.points.draw;
    }
  }

  const rows = [...table.values()];
  rows.sort((a, b) => compareWithTieBreakers(a, b, rules, results));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function goalDiff(r: StandingRow): number {
  return r.goalsFor - r.goalsAgainst;
}

function compareWithTieBreakers(
  a: StandingRow,
  b: StandingRow,
  rules: StandingsRules,
  results: MatchResultInput[],
): number {
  for (const key of rules.tieBreakers) {
    let cmp = 0;
    switch (key) {
      case 'points':
        cmp = b.points - a.points;
        break;
      case 'goal_difference':
        cmp = goalDiff(b) - goalDiff(a);
        break;
      case 'goals_for':
        cmp = b.goalsFor - a.goalsFor;
        break;
      case 'head_to_head': {
        const h2h = headToHead(a.teamId, b.teamId, results);
        cmp = h2h;
        break;
      }
      case 'wins':
        cmp = b.won - a.won;
        break;
      case 'random_draw':
        cmp = a.teamId.localeCompare(b.teamId);
        break;
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function headToHead(
  a: string,
  b: string,
  results: MatchResultInput[],
): number {
  const m = results.find(
    (r) =>
      (r.homeTeamId === a && r.awayTeamId === b) ||
      (r.homeTeamId === b && r.awayTeamId === a),
  );
  if (!m) return 0;
  const aGoals =
    m.homeTeamId === a ? m.homeScore : m.awayScore;
  const bGoals =
    m.homeTeamId === b ? m.homeScore : m.awayScore;
  return bGoals - aGoals;
}

export function resolveAdvancersFromStandings(
  groupStandings: StandingRow[][],
  rule: { topNPerGroup?: number; bestThirdPlace?: number },
): string[] {
  const topN = rule.topNPerGroup ?? 2;
  const advancers: string[] = [];
  const thirds: StandingRow[] = [];

  for (const standings of groupStandings) {
    const sorted = [...standings].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    advancers.push(...sorted.slice(0, topN).map((s) => s.teamId));
    if (sorted.length >= 3) thirds.push(sorted[2]);
  }

  const bestThird = rule.bestThirdPlace ?? 0;
  if (bestThird > 0) {
    thirds.sort((a, b) => b.points - a.points || goalDiff(b) - goalDiff(a));
    advancers.push(...thirds.slice(0, bestThird).map((s) => s.teamId));
  }

  return [...new Set(advancers)];
}
