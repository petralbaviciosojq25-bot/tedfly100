export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

const CATEGORY_NAMES = [
  'high-card',
  'pair',
  'two-pair',
  'three-of-a-kind',
  'straight',
  'flush',
  'full-house',
  'four-of-a-kind',
  'straight-flush',
];

export function cardRank(card) {
  const rank = RANKS.indexOf(String(card).trim().toUpperCase()[0]);
  if (rank < 0) throw new RangeError(`Invalid card rank: ${card}`);
  return rank + 2;
}

export function cardSuit(card) {
  const value = String(card).trim().toLowerCase();
  const suit = value[value.length - 1];
  if (!SUITS.includes(suit)) throw new RangeError(`Invalid card suit: ${card}`);
  return suit;
}

export function normalizeCard(card) {
  const value = String(card).trim();
  const rankText = value.length === 3 && value.startsWith('10') ? 'T' : value[0];
  const suit = value[value.length - 1].toLowerCase();
  const rank = rankText.toUpperCase();
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) throw new RangeError(`Invalid card: ${card}`);
  return `${rank}${suit}`;
}

export function createDeck(excluded = []) {
  const blocked = new Set(excluded.map(normalizeCard));
  return RANKS.split('').flatMap(rank => SUITS.split('').map(suit => `${rank}${suit}`))
    .filter(card => !blocked.has(card));
}

export function combinations(items, size) {
  if (!Number.isInteger(size) || size < 0) throw new RangeError('Combination size must be a non-negative integer');
  const result = [];
  const source = [...items];
  const walk = (start, picked) => {
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    const needed = size - picked.length;
    for (let index = start; index <= source.length - needed; index += 1) {
      picked.push(source[index]);
      walk(index + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return result;
}

export function compareRanks(left, right) {
  const a = left || [];
  const b = right || [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function straightHigh(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    if (unique[index] - unique[index + 4] === 4) return unique[index] === 1 ? 5 : unique[index];
  }
  return 0;
}

export function evaluateFive(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) throw new RangeError('evaluateFive requires exactly five cards');
  const normalized = cards.map(normalizeCard);
  if (new Set(normalized).size !== normalized.length) throw new Error('Duplicate cards in hand');
  const ranks = normalized.map(cardRank);
  const counts = new Map();
  ranks.forEach(rank => counts.set(rank, (counts.get(rank) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = normalized.every(card => cardSuit(card) === cardSuit(normalized[0]));
  const straight = straightHigh(ranks);
  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks.sort((a, b) => b - a)];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.slice(1).map(group => group[0]).sort((a, b) => b - a)];
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return [2, ...pairs, groups[2][0]];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.slice(1).map(group => group[0]).sort((a, b) => b - a)];
  return [0, ...ranks.sort((a, b) => b - a)];
}

export function evaluate(cards) {
  const normalized = cards.map(normalizeCard);
  if (normalized.length < 5 || normalized.length > 7) throw new RangeError('evaluate requires five to seven cards');
  return combinations(normalized, 5).reduce((best, five) => {
    const rank = evaluateFive(five);
    return compareRanks(rank, best) > 0 ? rank : best;
  }, [-1]);
}

export function categoryName(rank) {
  return CATEGORY_NAMES[rank?.[0]] || 'unknown';
}
