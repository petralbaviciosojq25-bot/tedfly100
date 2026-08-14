import { combinations, createDeck, evaluate, normalizeCard, compareRanks } from './cards.mjs';
import { EQUITY_VERSION } from './version.mjs';

function flattenHands(hero, opponents) {
  return [hero, ...(opponents || [])].flat().map(normalizeCard);
}

function validateKnownCards(hero, opponents, board) {
  const cards = flattenHands(hero, opponents).concat(board.map(normalizeCard));
  if (new Set(cards).size !== cards.length) throw new Error('Duplicate cards are not allowed in equity calculation');
  if (hero.length !== 2 || (opponents || []).some(hand => hand.length !== 2)) throw new Error('Every known player hand must contain exactly two cards');
}

export function enumerateEquity({ hero, opponents = [], board = [] } = {}) {
  if (!Array.isArray(hero) || !Array.isArray(opponents) || !Array.isArray(board)) throw new TypeError('hero, opponents and board must be arrays');
  validateKnownCards(hero, opponents, board);
  if (board.length > 5) throw new RangeError('Board cannot contain more than five cards');
  const known = flattenHands(hero, opponents).concat(board);
  const remaining = createDeck(known);
  const runouts = combinations(remaining, 5 - board.length);
  let wins = 0;
  let ties = 0;
  let share = 0;
  for (const runout of runouts) {
    const fullBoard = [...board, ...runout];
    const heroRank = evaluate([...hero, ...fullBoard]);
    const opponentRanks = opponents.map(hand => evaluate([...hand, ...fullBoard]));
    const bestOpponent = opponentRanks.reduce((best, rank) => !best || compareRanks(rank, best) > 0 ? rank : best, null);
    const best = bestOpponent && compareRanks(bestOpponent, heroRank) > 0 ? bestOpponent : heroRank;
    const winners = [heroRank, ...opponentRanks].filter(rank => compareRanks(rank, best) === 0).length;
    if (compareRanks(heroRank, best) === 0) {
      share += 1 / winners;
      if (winners === 1) wins += 1;
      else ties += 1;
    }
  }
  const total = runouts.length;
  return {
    version: EQUITY_VERSION,
    method: 'exact-enumeration',
    runouts: total,
    wins,
    ties,
    losses: total - wins - ties,
    equity: total ? share / total : 0,
    standardError: 0,
    confidence: 1,
  };
}
