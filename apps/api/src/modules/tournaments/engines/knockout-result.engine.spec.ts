import { resolveMatchWinner } from './knockout-result.engine';

describe('resolveMatchWinner', () => {
  const base = {
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeScore: 2,
    awayScore: 2,
  };

  it('returns null on tied approved knockout scores', () => {
    expect(
      resolveMatchWinner({ ...base, status: 'approved' }),
    ).toBeNull();
  });

  it('returns null on tied walkover scores', () => {
    expect(
      resolveMatchWinner({ ...base, status: 'walkover' }),
    ).toBeNull();
  });

  it('returns null on tied completed scores', () => {
    expect(
      resolveMatchWinner({ ...base, status: 'completed' }),
    ).toBeNull();
  });

  it('returns away winner when away leads', () => {
    expect(
      resolveMatchWinner({
        ...base,
        homeScore: 1,
        awayScore: 3,
        status: 'approved',
      }),
    ).toBe('away');
  });
});
