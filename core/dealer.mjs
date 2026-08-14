import { createDeck, normalizeCard } from './cards.mjs';
import { act, advanceStreet, createHand, RuleError } from './table_state.mjs';

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let value = hashSeed(seed) || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0x100000000;
  };
}

export function shuffleDeck(deck, random = Math.random) {
  const output = [...deck];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

export function dealHand(options = {}) {
  const { seed = 'default', deck: suppliedDeck, ...tableOptions } = options;
  const state = createHand(tableOptions);
  const blocked = state.players.flatMap(item => item.holeCards || []);
  state.deck = shuffleDeck((suppliedDeck || createDeck(blocked)).map(normalizeCard), seededRandom(seed));
  state.players.forEach(item => { item.holeCards = []; });
  for (let round = 0; round < 2; round += 1) {
    state.players.forEach(item => {
      if (item.status !== 'folded') item.holeCards.push(state.deck.shift());
    });
  }
  state.seed = String(seed);
  return state;
}

function drawCommunity(state, count) {
  if (!Array.isArray(state.deck) || state.deck.length < count + 1) throw new RuleError('DECK_EXHAUSTED', 'Not enough cards to deal the requested street');
  state.deck.shift();
  return state.deck.splice(0, count);
}

export function dealNextStreet(state) {
  if (state.status !== 'active') throw new RuleError('HAND_NOT_ACTIVE', `Hand is ${state.status}`);
  if (!state.pendingDeal || state.toAct !== null) throw new RuleError('STREET_NOT_READY', 'The current betting round must finish before dealing the next street');
  const count = state.board.length === 0 ? 3 : 1;
  if (state.board.length >= 5) throw new RuleError('BOARD_COMPLETE', 'The board already has five cards');
  advanceStreet(state, drawCommunity(state, count));
  return state;
}

export function runoutDeck(state) {
  while (state.status === 'active' && state.pendingDeal && state.toAct === null) dealNextStreet(state);
  if (state.status === 'showdown') return state;
  if (state.status !== 'active') return state;
  throw new RuleError('ACTION_REQUIRED', 'The hand still has live actions before a runout can continue');
}

export { act };
