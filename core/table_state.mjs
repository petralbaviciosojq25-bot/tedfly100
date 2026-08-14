import { CORE_VERSION, RULES_VERSION } from './version.mjs';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const ACTIVE = new Set(['active', 'all-in']);

export class RuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
    this.details = details;
  }
}

const nextIndex = (state, index) => (index + 1) % state.players.length;

function player(state, id) {
  const found = state.players.find(item => item.id === id);
  if (!found) throw new RuleError('UNKNOWN_PLAYER', `Unknown player: ${id}`);
  return found;
}

function activePlayers(state) {
  return state.players.filter(item => ACTIVE.has(item.status));
}

function actingPlayers(state) {
  return state.players.filter(item => item.status === 'active');
}

function totalPot(state) {
  return state.players.reduce((sum, item) => sum + item.committedTotal, 0);
}

function resolveBlinds(players, buttonIndex) {
  const byPosition = position => players.findIndex(item => item.position === position);
  if (players.length === 2) {
    const button = buttonIndex;
    return { button, smallBlind: button, bigBlind: nextIndex({ players }, button) };
  }
  const smallBlind = byPosition('SB') >= 0 ? byPosition('SB') : nextIndex({ players }, buttonIndex);
  const bigBlind = byPosition('BB') >= 0 ? byPosition('BB') : nextIndex({ players }, smallBlind);
  return { button: buttonIndex, smallBlind, bigBlind };
}

function firstActor(state, street) {
  const start = street === 'preflop' ? state.bigBlindIndex : state.buttonIndex;
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (start + offset) % state.players.length;
    if (state.players[index].status === 'active') return index;
  }
  return null;
}

function needsAction(state, item) {
  if (item.status !== 'active') return false;
  return item.streetContribution < state.currentBet || !item.actedSinceFullRaise;
}

function nextNeedingAction(state, fromIndex) {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (fromIndex + offset) % state.players.length;
    if (needsAction(state, state.players[index])) return index;
  }
  return null;
}

function requireTurn(state, id) {
  if (state.status !== 'active') throw new RuleError('HAND_NOT_ACTIVE', `Hand is ${state.status}`);
  const item = player(state, id);
  if (state.toAct !== state.players.indexOf(item)) throw new RuleError('OUT_OF_TURN', `${id} is not the player to act`);
  if (item.status !== 'active') throw new RuleError('PLAYER_NOT_ACTIVE', `${id} cannot act`);
  return item;
}

function resetStreet(state) {
  state.currentBet = 0;
  state.lastFullRaise = state.blinds.big;
  state.players.forEach(item => {
    item.streetContribution = 0;
    item.actedSinceFullRaise = item.status !== 'active';
  });
  state.toAct = state.pendingDeal ? null : firstActor(state, state.street);
}

function finishOrContinue(state, actorIndex) {
  if (activePlayers(state).length <= 1) {
    state.status = 'complete';
    state.toAct = null;
    state.result = { type: 'uncontested', winnerIds: activePlayers(state).map(item => item.id) };
    return state;
  }
  const waiting = actingPlayers(state).filter(item => needsAction(state, item));
  if (waiting.length > 0) {
    state.toAct = nextNeedingAction(state, actorIndex);
    return state;
  }
  state.toAct = null;
  if (state.street === 'river') {
    state.status = 'showdown';
    return state;
  }
  state.street = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1];
  state.pendingDeal = true;
  resetStreet(state);
  return state;
}

export function createHand({ players, buttonIndex = 0, blinds = { small: 0.5, big: 1 }, ante = 0 } = {}) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 6) throw new RuleError('INVALID_PLAYER_COUNT', 'Holdem table must have two to six players');
  if (!Number.isFinite(blinds.small) || !Number.isFinite(blinds.big) || blinds.small <= 0 || blinds.big <= blinds.small) throw new RuleError('INVALID_BLINDS', 'Blinds must be positive and big blind must be larger');
  if (!Number.isFinite(ante) || ante < 0) throw new RuleError('INVALID_ANTE', 'Ante must be a non-negative number');
  if (!Number.isInteger(buttonIndex) || buttonIndex < 0 || buttonIndex >= players.length) throw new RuleError('INVALID_BUTTON', 'buttonIndex is outside the player list');
  const ids = new Set();
  const state = {
    version: CORE_VERSION,
    rulesVersion: RULES_VERSION,
    status: 'active',
    street: 'preflop',
    board: [],
    players: players.map((item, index) => {
      if (!item?.id || ids.has(item.id)) throw new RuleError('INVALID_PLAYER', 'Player ids must be unique and non-empty');
      ids.add(item.id);
      if (!Number.isFinite(item.stack) || item.stack < 0) throw new RuleError('INVALID_STACK', `Invalid stack for ${item.id}`);
      return {
        id: item.id,
        position: item.position || `seat-${index + 1}`,
        stack: item.stack,
        status: 'active',
        committedTotal: 0,
        streetContribution: 0,
        actedSinceFullRaise: false,
      };
    }),
    buttonIndex,
    blinds: { small: blinds.small, big: blinds.big },
    ante,
    currentBet: 0,
    lastFullRaise: blinds.big,
    toAct: null,
    smallBlindIndex: null,
    bigBlindIndex: null,
    pot: 0,
    pendingDeal: false,
    actionLog: [],
  };
  const blindIndices = resolveBlinds(state.players, buttonIndex);
  state.smallBlindIndex = blindIndices.smallBlind;
  state.bigBlindIndex = blindIndices.bigBlind;
  state.players.forEach(item => {
    if (ante > 0) {
      const paid = Math.min(item.stack, ante);
      item.stack -= paid;
      item.committedTotal += paid;
    }
  });
  const post = (index, amount, type) => {
    const item = state.players[index];
    const paid = Math.min(item.stack, amount);
    item.stack -= paid;
    item.streetContribution += paid;
    item.committedTotal += paid;
    if (item.stack === 0) item.status = 'all-in';
    state.actionLog.push({ street: 'preflop', playerId: item.id, type, paid, to: item.streetContribution, forced: true });
  };
  post(state.smallBlindIndex, blinds.small, 'small-blind');
  post(state.bigBlindIndex, blinds.big, 'big-blind');
  state.currentBet = Math.max(...state.players.map(item => item.streetContribution));
  state.pot = totalPot(state);
  state.toAct = firstActor(state, 'preflop');
  if (state.toAct == null) state.pendingDeal = true;
  return state;
}

export function getPot(state) {
  return totalPot(state);
}

export function getCallAmount(state, id = state.players[state.toAct]?.id) {
  const item = player(state, id);
  return Math.max(0, state.currentBet - item.streetContribution);
}

export function getMinRaiseTo(state, id = state.players[state.toAct]?.id) {
  const item = player(state, id);
  return state.currentBet > item.streetContribution ? state.currentBet + state.lastFullRaise : Math.max(state.blinds.big, item.streetContribution + state.blinds.big);
}

export function getLegalActions(state, id = state.players[state.toAct]?.id) {
  const item = player(state, id);
  if (state.status !== 'active' || state.toAct !== state.players.indexOf(item) || item.status !== 'active') return [];
  const callAmount = getCallAmount(state, id);
  const allInTo = item.streetContribution + item.stack;
  const actions = [{ type: 'fold' }];
  if (callAmount === 0) actions.push({ type: 'check' });
  else if (item.stack > 0) actions.push({ type: 'call', amount: Math.min(callAmount, item.stack) });
  if (item.stack > 0) {
    const minTo = getMinRaiseTo(state, id);
    if (state.currentBet === item.streetContribution && minTo <= allInTo) actions.push({ type: 'bet', minTo, maxTo: allInTo });
    else if (state.currentBet > item.streetContribution && !item.actedSinceFullRaise && minTo <= allInTo) actions.push({ type: 'raise', minTo, maxTo: allInTo });
    if (allInTo > state.currentBet && !item.actedSinceFullRaise) actions.push({ type: 'all-in', to: allInTo, fullRaise: allInTo >= minTo });
  }
  return actions;
}

function updateRaiseRights(state, actor, previousBet, newBet, fullRaise) {
  if (newBet > previousBet && fullRaise) {
    state.players.forEach(item => { item.actedSinceFullRaise = item.status !== 'active'; });
    actor.actedSinceFullRaise = true;
    state.lastFullRaise = newBet - previousBet;
  } else {
    actor.actedSinceFullRaise = true;
  }
}

export function act(state, { playerId, type, to } = {}) {
  const actor = requireTurn(state, playerId);
  const legal = getLegalActions(state, playerId);
  const allowed = legal.find(item => item.type === type);
  if (!allowed) throw new RuleError('ILLEGAL_ACTION', `${type} is not legal for ${playerId}`, { legal });
  const actorIndex = state.players.indexOf(actor);
  const before = { pot: state.pot, currentBet: state.currentBet, stack: actor.stack, streetContribution: actor.streetContribution };
  let target = actor.streetContribution;
  let paid = 0;
  let fullRaise = false;
  if (type === 'fold') {
    actor.status = 'folded';
    actor.actedSinceFullRaise = true;
  } else if (type === 'check') {
    actor.actedSinceFullRaise = true;
  } else if (type === 'call') {
    target = Math.min(state.currentBet, actor.streetContribution + actor.stack);
    paid = target - actor.streetContribution;
    actor.stack -= paid;
    actor.streetContribution = target;
    actor.committedTotal += paid;
    if (actor.stack === 0) actor.status = 'all-in';
    actor.actedSinceFullRaise = true;
  } else {
    target = type === 'all-in' ? actor.streetContribution + actor.stack : Number(to);
    if (!Number.isFinite(target) || target <= actor.streetContribution || target > actor.streetContribution + actor.stack) throw new RuleError('INVALID_AMOUNT', 'Action amount must be a positive amount up to the player stack', { target });
    const minTo = type === 'bet' ? Math.max(state.blinds.big, actor.streetContribution + state.blinds.big) : state.currentBet + state.lastFullRaise;
    const isAllIn = target === actor.streetContribution + actor.stack;
    if (type === 'bet' && state.currentBet > actor.streetContribution) throw new RuleError('BET_FACING_ACTION', 'Use raise when facing a wager');
    if (type === 'raise' && state.currentBet === actor.streetContribution) throw new RuleError('RAISE_WITHOUT_BET', 'Use bet when there is no wager');
    if (type === 'raise' && actor.actedSinceFullRaise && !isAllIn) throw new RuleError('RAISE_NOT_REOPENED', 'A short all-in did not reopen raising for this player');
    if (target < minTo && !isAllIn) throw new RuleError('BELOW_MINIMUM_RAISE', `Action must be at least ${minTo} to`, { minTo, target });
    paid = target - actor.streetContribution;
    const previousBet = state.currentBet;
    actor.stack -= paid;
    actor.streetContribution = target;
    actor.committedTotal += paid;
    if (actor.stack === 0) actor.status = 'all-in';
    state.currentBet = Math.max(state.currentBet, target);
    fullRaise = target >= minTo;
    updateRaiseRights(state, actor, previousBet, target, fullRaise);
  }
  state.pot = totalPot(state);
  state.actionLog.push({ street: state.street, playerId, type, paid, to: actor.streetContribution, currentBet: state.currentBet, fullRaise });
  finishOrContinue(state, actorIndex);
  return state;
}

export function advanceStreet(state, cards = []) {
  if (state.status !== 'active') throw new RuleError('HAND_NOT_ACTIVE', `Hand is ${state.status}`);
  if (!state.pendingDeal || state.toAct !== null) throw new RuleError('STREET_NOT_COMPLETE', 'The current betting round is not complete or is already dealt');
  const count = state.board.length === 0 ? 3 : 1;
  if (cards.length && cards.length !== count) throw new RuleError('INVALID_BOARD_CARDS', `Expected ${count} cards for ${state.street}`);
  state.board.push(...cards);
  state.pendingDeal = false;
  state.toAct = firstActor(state, state.street);
  if (state.toAct == null) {
    if (state.street === 'river') state.status = 'showdown';
    else {
      state.street = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1];
      state.pendingDeal = true;
      resetStreet(state);
    }
  }
  return state;
}

export function runout(state, cards) {
  if (state.status !== 'active' && state.status !== 'showdown') throw new RuleError('HAND_NOT_ACTIVE', `Hand is ${state.status}`);
  if (state.status === 'showdown') return state;
  if (!state.pendingDeal || state.toAct !== null) throw new RuleError('ACTION_REQUIRED', 'The hand still has live actions before a runout can continue');
  if (cards.length !== (state.street === 'preflop' ? 5 : state.street === 'flop' ? 2 : state.street === 'turn' ? 1 : 0)) throw new RuleError('INVALID_RUNOUT', 'Runout card count does not match the current street');
  if (state.street === 'flop') state.board.push(...cards.slice(0, 3));
  if (state.street === 'turn') state.board.push(cards[0]);
  if (state.street === 'river') state.board.push(cards[0]);
  state.pendingDeal = false;
  state.toAct = firstActor(state, state.street);
  if (state.street === 'river' || state.toAct !== null) return state;
  state.street = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1];
  state.pendingDeal = true;
  resetStreet(state);
  return state;
}

export function buildPots(state) {
  const levels = [...new Set(state.players.map(item => item.committedTotal).filter(value => value > 0))].sort((a, b) => a - b);
  const pots = [];
  let previous = 0;
  for (const cap of levels) {
    const contributors = state.players.filter(item => item.committedTotal >= cap);
    const amount = (cap - previous) * contributors.length;
    const eligible = contributors.filter(item => item.status !== 'folded').map(item => item.id);
    if (amount > 0) pots.push({ cap, amount, eligible });
    previous = cap;
  }
  return pots;
}

export function settleShowdown(state, ranksByPlayer) {
  if (state.status !== 'showdown' && state.status !== 'complete') throw new RuleError('SHOWDOWN_NOT_READY', 'Hand is not ready for showdown');
  const pots = buildPots(state);
  const payouts = Object.fromEntries(state.players.map(item => [item.id, 0]));
  const rankMap = ranksByPlayer && typeof ranksByPlayer === 'object' ? ranksByPlayer : {};
  const uncontested = state.status === 'complete' && state.result?.type === 'uncontested';
  const winnerIds = new Set(state.result?.winnerIds || []);
  const chipUnit = 0.01;
  const toUnits = amount => Math.round(amount / chipUnit);
  const fromUnits = units => Number((units * chipUnit).toFixed(2));
  const oddChipOrder = state.players.map((_, offset) => state.players[(state.buttonIndex + 1 + offset) % state.players.length].id);
  for (const pot of pots) {
    const eligible = uncontested ? pot.eligible.filter(id => winnerIds.has(id)) : pot.eligible;
    if (!eligible.length) throw new RuleError('UNASSIGNED_POT', `Pot ${pot.cap} has no eligible winner`);
    if (!uncontested) {
      const missing = eligible.filter(id => !Array.isArray(rankMap[id]) || !rankMap[id].length);
      if (missing.length) throw new RuleError('MISSING_HAND_RANK', `Missing showdown rank for ${missing.join(', ')}`, { playerIds: missing });
    }
    const best = uncontested ? eligible[0] : eligible.reduce((current, id) => !current || compareRankArrays(rankMap[id], rankMap[current]) > 0 ? id : current, null);
    const winners = uncontested ? eligible : eligible.filter(id => compareRankArrays(rankMap[id], rankMap[best]) === 0);
    const amountUnits = toUnits(pot.amount);
    const shareUnits = Math.floor(amountUnits / winners.length);
    let remainderUnits = amountUnits - shareUnits * winners.length;
    const orderedWinners = [...winners].sort((left, right) => oddChipOrder.indexOf(left) - oddChipOrder.indexOf(right));
    orderedWinners.forEach(id => {
      payouts[id] += fromUnits(shareUnits + (remainderUnits > 0 ? 1 : 0));
      remainderUnits -= 1;
    });
  }
  const settledAmount = Number(payouts ? Object.values(payouts).reduce((sum, amount) => sum + amount, 0).toFixed(2) : 0);
  const potAmount = Number(pots.reduce((sum, pot) => sum + pot.amount, 0).toFixed(2));
  if (settledAmount !== potAmount) throw new RuleError('PAYOUT_MISMATCH', `Payout ${settledAmount} does not equal pot ${potAmount}`, { settledAmount, potAmount });
  state.players.forEach(item => {
    item.stack = Number((item.stack + payouts[item.id]).toFixed(2));
    item.committedTotal = 0;
    item.streetContribution = 0;
  });
  state.payouts = payouts;
  state.settledPot = potAmount;
  state.pot = 0;
  state.status = 'settled';
  state.toAct = null;
  return { pots, payouts };
}

function compareRankArrays(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
