export type FixtureDraft = {
  round: number;
  homeTeamId: string;
  awayTeamId: string;
};

function rotate(ids: string[]): void {
  const fixed = ids[0];
  const rest = ids.slice(1);
  rest.unshift(rest.pop()!);
  ids.splice(0, ids.length, fixed, ...rest);
}

export function generateRoundRobinFixtures(
  teamIds: string[],
  maxRounds?: number,
): FixtureDraft[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push('__BYE__');
  const n = ids.length;
  const rounds =
    maxRounds != null ? Math.min(Math.max(1, maxRounds), n - 1) : n - 1;
  const fixtures: FixtureDraft[] = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const home = ids[i];
      const away = ids[n - 1 - i];
      if (home !== '__BYE__' && away !== '__BYE__') {
        fixtures.push({ round: r + 1, homeTeamId: home, awayTeamId: away });
      }
    }
    rotate(ids);
  }
  return fixtures;
}
