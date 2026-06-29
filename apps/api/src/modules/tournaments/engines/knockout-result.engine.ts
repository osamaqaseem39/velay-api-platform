export function resolveMatchWinner(match: {
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  status: string;
}): string | null {
  if (!match.homeTeamId && !match.awayTeamId) return null;
  if (match.status === 'walkover' || match.status === 'approved') {
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    if (home > away) return match.homeTeamId ?? null;
    if (away > home) return match.awayTeamId ?? null;
    return null;
  }
  if (match.status === 'completed') {
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    if (home > away) return match.homeTeamId ?? null;
    if (away > home) return match.awayTeamId ?? null;
    if (home === away) return null;
  }
  return null;
}
