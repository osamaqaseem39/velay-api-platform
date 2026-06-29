import type {
  StructureBlueprint,
  TournamentStructureType,
} from '../types/tournament.types';

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function suggestGroupCount(n: number): number {
  if (n <= 4) return 1;
  if (n <= 6) return 2;
  if (n <= 12) return 3;
  if (n <= 20) return 4;
  if (n <= 32) return 8;
  return Math.ceil(Math.sqrt(n));
}

export function generateBalancedGroups(
  n: number,
  requestedGroups?: number,
  opts?: { minPerGroup?: number; maxPerGroup?: number },
): number[] {
  if (n <= 0) throw new Error('INVALID_TEAM_COUNT');
  if (n === 1) return [1];

  const g = requestedGroups ?? suggestGroupCount(n);
  if (g < 1) throw new Error('INVALID_GROUP_COUNT');

  const min = opts?.minPerGroup ?? 1;
  const max = opts?.maxPerGroup ?? Math.ceil(n / g);
  if (min > max) throw new Error('INVALID_GROUP_BOUNDS');
  if (g * min > n) throw new Error('TOO_FEW_TEAMS');
  if (g * max < n) throw new Error('TOO_MANY_TEAMS');

  const sizes = new Array<number>(g).fill(min);
  let remaining = n - g * min;
  let i = 0;
  let guard = 0;
  while (remaining > 0 && guard < g * n) {
    const room = max - sizes[i];
    if (room > 0) {
      const add = Math.min(room, remaining);
      sizes[i] += add;
      remaining -= add;
    }
    i = (i + 1) % g;
    guard++;
  }
  if (remaining > 0) throw new Error('TOO_MANY_TEAMS');
  return sizes;
}

export function allocateByes(teamCount: number): {
  bracketSize: number;
  byeCount: number;
} {
  const bracketSize = nextPowerOfTwo(teamCount);
  return { bracketSize, byeCount: bracketSize - teamCount };
}

function resolveAdvancerCount(
  groupSizes: number[],
  advancement?: Record<string, unknown>,
): number {
  const topN = Number(advancement?.topNPerGroup ?? 2);
  let count = groupSizes.length * topN;
  const bestThird = Number(advancement?.bestThirdPlace ?? 0);
  count += bestThird;
  return count;
}

export function previewStructure(input: {
  teamCount: number;
  structureType: TournamentStructureType;
  advancement?: Record<string, unknown>;
  groupCount?: number;
  minTeamsPerGroup?: number;
  maxTeamsPerGroup?: number;
  matchesPerTeam?: number;
}): StructureBlueprint {
  const {
    teamCount,
    structureType,
    advancement,
    groupCount,
    minTeamsPerGroup,
    maxTeamsPerGroup,
    matchesPerTeam,
  } = input;

  if (structureType === 'direct_knockout') {
    const { bracketSize, byeCount } = allocateByes(teamCount);
    return {
      teamCount,
      structureType,
      knockout: {
        bracketSize,
        byes: byeCount,
        rounds: Math.log2(bracketSize),
      },
    };
  }

  if (
    structureType === 'group_only' ||
    structureType === 'group_plus_knockout' ||
    structureType === 'qualifier_group_knockout'
  ) {
    const sizes = generateBalancedGroups(teamCount, groupCount, {
      minPerGroup: minTeamsPerGroup,
      maxPerGroup: maxTeamsPerGroup,
    });
    const groups = sizes.map((size, i) => ({
      name: String.fromCharCode(65 + i),
      size,
    }));
    const maxSize = Math.max(...sizes);
    const fullRoundRobin = maxSize - 1;
    const perTeam = Math.min(
      matchesPerTeam ?? fullRoundRobin,
      fullRoundRobin,
    );
    const blueprint: StructureBlueprint = {
      teamCount,
      structureType,
      groups,
      groupStage: {
        rounds: perTeam,
        matchesPerTeam: perTeam,
        groupCount: sizes.length,
        minTeamsPerGroup: minTeamsPerGroup,
        maxTeamsPerGroup: maxTeamsPerGroup,
      },
      advancement,
    };
    if (
      structureType === 'group_plus_knockout' ||
      structureType === 'qualifier_group_knockout'
    ) {
      const advCount = resolveAdvancerCount(sizes, advancement);
      const { bracketSize, byeCount } = allocateByes(advCount);
      blueprint.knockout = {
        bracketSize,
        byes: byeCount,
        rounds: Math.log2(bracketSize),
      };
    }
    return blueprint;
  }

  return {
    teamCount,
    structureType,
    stages: [
      { order: 1, name: 'Stage 1', stageType: 'group' },
      { order: 2, name: 'Stage 2', stageType: 'knockout' },
    ],
    advancement,
  };
}

export const TOURNAMENT_TEMPLATES = [
  { teamCount: 4, label: '4 teams' },
  { teamCount: 5, label: '5 teams' },
  { teamCount: 7, label: '7 teams' },
  { teamCount: 8, label: '8 teams' },
  { teamCount: 9, label: '9 teams' },
  { teamCount: 11, label: '11 teams' },
  { teamCount: 13, label: '13 teams' },
  { teamCount: 16, label: '16 teams' },
  { teamCount: 17, label: '17 teams' },
  { teamCount: 21, label: '21 teams' },
  { teamCount: 24, label: '24 teams' },
  { teamCount: 27, label: '27 teams' },
  { teamCount: 32, label: '32 teams' },
  { teamCount: 64, label: '64 teams' },
];
