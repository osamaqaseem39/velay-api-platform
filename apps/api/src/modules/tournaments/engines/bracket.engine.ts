import { allocateByes } from './structure.engine';

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

export function generateKnockoutBracket(
  teamIds: string[],
  bracketSize?: number,
): BracketNodeDraft[] {
  const size = bracketSize ?? allocateByes(teamIds.length).bracketSize;
  const rounds = Math.log2(size);
  const nodes: BracketNodeDraft[] = [];

  for (let round = 1; round <= rounds; round++) {
    const matchCount = size / Math.pow(2, round);
    for (let slot = 0; slot < matchCount; slot++) {
      const draft: BracketNodeDraft = { round, slotIndex: slot, isBye: false };
      if (round < rounds) {
        draft.parentRound = round + 1;
        draft.parentSlotIndex = Math.floor(slot / 2);
      }
      nodes.push(draft);
    }
  }

  const round1Slots = size / 2;
  const seeded = [...teamIds];
  while (seeded.length < size) seeded.push('__BYE__');

  for (let i = 0; i < round1Slots; i++) {
    const home = seeded[i];
    const away = seeded[size - 1 - i];
    const node = nodes.find((n) => n.round === 1 && n.slotIndex === i);
    if (!node) continue;
    if (home === '__BYE__' && away === '__BYE__') {
      node.isBye = true;
    } else if (home === '__BYE__') {
      node.isBye = true;
      node.teamId = away;
    } else if (away === '__BYE__') {
      node.isBye = true;
      node.teamId = home;
    } else {
      node.teamId = home;
      node.awayTeamId = away;
    }
  }

  return nodes;
}
