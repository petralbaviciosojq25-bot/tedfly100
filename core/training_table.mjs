import {
  act,
  getCallAmount,
  getLegalActions,
  getPot,
  settleShowdown,
} from './table_state.mjs';
import { dealHand, dealNextStreet } from './dealer.mjs';
import { evaluate } from './cards.mjs';
import { enumerateEquity } from './equity.mjs';
import { calculateICM } from './icm.mjs';
import { BOT_PROFILE_IDS, botProfile } from './bot_profiles.mjs';

export const SIX_MAX_POSITIONS = Object.freeze(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
const BOT_STYLES = BOT_PROFILE_IDS;

function hashSeed(seed) {
  let value = 2166136261;
  for (const char of String(seed)) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function rngFrom(seed) {
  let value = hashSeed(seed) || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0x100000000;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundChip(value) {
  return Number(Number(value).toFixed(2));
}

function compareRanks(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

function sampleRunout(deck, count, random) {
  const remaining = [...deck];
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(random() * (remaining.length - index));
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
  }
  return remaining.slice(0, count);
}

function choose(list, random) {
  return list[Math.floor(random() * list.length)] || list[0];
}

function botStrength(state, player) {
  const cards = player.holeCards || [];
  if (state.board.length < 3) {
    if (cards.length !== 2) return 0.35;
    const ranks = cards.map(card => '23456789TJQKA'.indexOf(card[0]) + 2).sort((a, b) => b - a);
    const pairBonus = ranks[0] === ranks[1] ? 0.28 : 0;
    return clamp((ranks[0] + ranks[1]) /  thirtyEight() + pairBonus, 0, 1);
  }
  const rank = evaluate([...cards, ...state.board]);
  return clamp((rank[0] / 8) * 0.78 + (rank[1] || 0) / 14 * 0.22, 0, 1);
}

function thirtyEight() {
  return 38;
}

function actionTarget(state, player, action, random) {
  if (action.type === 'all-in') return undefined;
  if (action.type !== 'bet' && action.type !== 'raise') return undefined;
  const fraction = choose([0.33, 0.5, 0.75, 1.25], random);
  const base = state.currentBet > player.streetContribution ? state.currentBet : player.streetContribution;
  const desired = base + getPot(state) * fraction;
  return roundChip(clamp(desired, action.minTo, action.maxTo));
}

function strategyActionType(actionKey, legal) {
  if (actionKey === 'fold') return legal.find(action => action.type === 'fold');
  if (actionKey === 'check') return legal.find(action => action.type === 'check');
  if (actionKey === 'call') return legal.find(action => action.type === 'call');
  if (actionKey === 'jam' || actionKey === 'all-in') return legal.find(action => action.type === 'all-in');
  if (actionKey.startsWith('bet')) return legal.find(action => action.type === 'bet');
  if (actionKey.startsWith('raise')) return legal.find(action => action.type === 'raise');
  return null;
}

function strategyTarget(state, player, action, actionKey) {
  if (action.type === 'all-in') return undefined;
  if (action.type !== 'bet' && action.type !== 'raise') return undefined;
  const size = actionKey.match(/(?:bet|raise)(33|50|75|125)$/);
  const fraction = size ? Number(size[1]) / 100 : 0.5;
  const base = state.currentBet > player.streetContribution ? state.currentBet : player.streetContribution;
  return roundChip(clamp(base + getPot(state) * fraction, action.minTo, action.maxTo));
}

function chooseWeighted(rows, random) {
  const total = rows.reduce((sum, [, weight]) => sum + Math.max(0, Number(weight) || 0), 0);
  if (total <= 0) return rows[0]?.[0] || null;
  let target = random() * total;
  for (const [key, weight] of rows) {
    target -= Math.max(0, Number(weight) || 0);
    if (target <= 0) return key;
  }
  return rows.at(-1)?.[0] || null;
}

function chooseVerifiedStrategyAction(table, player, legal) {
  if (typeof table.strategyResolver !== 'function') return null;
  let resolved;
  try {
    resolved = table.strategyResolver({ table, state: table.state, player, legal });
  } catch (error) {
    resolved = { status: 'approximate', label: 'approximate strategy - resolver error', error: error.message };
  }
  const evidence = resolved || { status: 'approximate', label: 'approximate strategy - node not covered' };
  if (evidence.status !== 'verified' || !evidence.frequencies) return { strategyEvidence: evidence };
  const rows = Object.entries(evidence.frequencies).filter(([key, value]) => strategyActionType(key, legal) && Number(value) > 0);
  if (!rows.length) return { strategyEvidence: { ...evidence, status: 'approximate', label: `${evidence.label || 'verified strategy'} - no legal action` } };
  const actionKey = chooseWeighted(rows, table.random);
  const action = strategyActionType(actionKey, legal);
  return {
    type: action.type,
    to: strategyTarget(table.state, player, action, actionKey),
    strategyAction: actionKey,
    strategyProbability: Number(evidence.frequencies[actionKey] || 0),
    strategyConfidence: Number(evidence.confidence ?? 0.75),
    strategyEvidence: evidence,
  };
}

function chooseBotAction(table, player) {
  const { state, random } = table;
  const legal = getLegalActions(state, player.id);
  if (!legal.length) return null;
  const strategyDecision = chooseVerifiedStrategyAction(table, player, legal);
  if (strategyDecision?.type) return strategyDecision;
  const strategyEvidence = strategyDecision?.strategyEvidence || { status: 'approximate', label: 'approximate strategy - node not covered' };
  const byType = type => legal.find(action => action.type === type);
  const style = player.botStyle || 'solver';
  const strength = botStrength(state, player);
  const profile = botProfile(style);
  const pressure = profile.pressure;
  const facing = getCallAmount(state, player.id) > 0;
  let selected;
  if (!facing) {
    const aggressive = strength + pressure > 0.68 || (strength > 0.48 && random() < 0.24 + Math.max(pressure, 0));
    selected = aggressive ? (byType('bet') || byType('all-in') || byType('check')) : (byType('check') || byType('bet'));
  } else {
    const foldThreshold = profile.foldThreshold;
    const raiseThreshold = profile.raiseThreshold;
    if (strength < foldThreshold && byType('fold') && random() > 0.12) selected = byType('fold');
    else if (strength > raiseThreshold && random() < 0.42) selected = byType('raise') || byType('all-in') || byType('call');
    else selected = byType('call') || byType('all-in') || byType('fold');
  }
  if (!selected) selected = choose(legal, random);
  return { type: selected.type, to: actionTarget(state, player, selected, random), strategyConfidence: Number(strategyEvidence.confidence ?? 0.1), strategyEvidence };
}

/**
 * Calculates the hero's current equity against the hidden hands used by the
 * training table. The cards remain hidden in the UI; this is an exact
 * postflop truth value and a deterministic preflop estimate used for review.
 */
export function estimateHeroEquity(table, { preflopSamples = 2048 } = {}) {
  const state = table.state;
  const hero = heroPlayer(table);
  const opponents = state.players
    .filter(player => player.id !== table.heroId && player.status !== 'folded' && player.holeCards?.length === 2)
    .map(player => [...player.holeCards]);
  if (!hero?.holeCards?.length || !opponents.length) {
    return { equity: 1, method: 'no-opponents', runouts: 0, confidence: 1 };
  }

  const board = [...state.board];
  const remaining = [...(state.deck || [])];
  if (board.length >= 3) {
    const exact = enumerateEquity({ hero: hero.holeCards, opponents, board });
    return { ...exact, method: 'exact-known-hands', opponentCount: opponents.length };
  }

  const runouts = Math.max(1, preflopSamples);
  const random = table.equityRandom || (table.equityRandom = rngFrom(`${table.seed}:equity`));
  let share = 0;

  for (let index = 0; index < runouts; index += 1) {
    const runout = sampleRunout(remaining, 5 - board.length, random);
    const fullBoard = [...board, ...runout];
    const heroRank = evaluate([...hero.holeCards, ...fullBoard]);
    const opponentRanks = opponents.map(hand => evaluate([...hand, ...fullBoard]));
    const best = opponentRanks.reduce((current, rank) => !current || compareRanks(rank, current) > 0 ? rank : current, heroRank);
    const winners = [heroRank, ...opponentRanks].filter(rank => compareRanks(rank, best) === 0).length;
    if (compareRanks(heroRank, best) === 0) share += 1 / winners;
  }

  return {
    equity: share / runouts,
    method: 'sampled-known-hands',
    runouts,
    confidence: 0.92,
    opponentCount: opponents.length,
  };
}

function buildPotWinners(pots, ranks, fallbackWinnerIds = []) {
  return pots.map(pot => {
    if (!Object.keys(ranks).length) {
      return { ...pot, winnerIds: pot.eligible.filter(id => fallbackWinnerIds.includes(id)) };
    }
    const bestPlayer = pot.eligible.reduce((best, id) => !best || compareRanks(ranks[id], ranks[best]) > 0 ? id : best, null);
    const winnerIds = pot.eligible.filter(id => compareRanks(ranks[id], ranks[bestPlayer]) === 0);
    return { ...pot, winnerIds };
  });
}

function finishIfReady(table) {
  const { state } = table;
  if (state.status === 'showdown') {
    const ranks = Object.fromEntries(state.players.filter(player => player.status !== 'folded').map(player => [player.id, evaluate([...(player.holeCards || []), ...state.board])]));
    const result = settleShowdown(state, ranks);
    const potWinners = buildPotWinners(result.pots, ranks);
    const winnerIds = [...new Set(potWinners.flatMap(pot => pot.winnerIds))];
    state.result = { type: 'showdown', winnerIds, potWinners, payouts: result.payouts };
    table.ended = true;
  } else if (state.status === 'complete') {
    const result = settleShowdown(state, {});
    const previous = state.result || { type: 'uncontested', winnerIds: [] };
    const potWinners = buildPotWinners(result.pots, {}, previous.winnerIds || []);
    state.result = { ...previous, winnerIds: [...new Set(potWinners.flatMap(pot => pot.winnerIds))], potWinners, payouts: result.payouts };
    table.ended = true;
  }
  return table;
}

export function createSixMaxTrainingTable({ seed = 'six-max', heroPosition = 'BTN', stack = 100, blinds = { small: 0.5, big: 1 }, strategyResolver = null, tournament = null } = {}) {
  const heroIndex = Math.max(0, SIX_MAX_POSITIONS.indexOf(heroPosition));
  const state = dealHand({
    seed,
    buttonIndex: 3,
    blinds,
    players: SIX_MAX_POSITIONS.map((position, index) => ({ id: position.toLowerCase(), position, stack: Number(stack) + (index % 3) * 5 })),
  });
  let botIndex = 0;
  state.players.forEach((player, index) => {
    player.isHero = index === heroIndex;
    player.botStyle = player.isHero ? null : BOT_STYLES[botIndex++ % BOT_STYLES.length];
  });
  const table = { state, heroId: state.players[heroIndex].id, heroPosition, seed: String(seed), stackBB: Number(stack), random: rngFrom(seed), equityRandom: rngFrom(`${seed}:equity`), strategyResolver, tournament, strategyStats: { verified: 0, unverified: 0, approximate: 0 }, ended: false, botActions: [] };
  advanceToHero(table);
  return table;
}

export function heroPlayer(table) {
  return table.state.players.find(player => player.id === table.heroId);
}

export function currentPlayer(table) {
  return table.state.players[table.state.toAct] || null;
}

export function legalHeroActions(table) {
  if (table.ended || table.state.status !== 'active' || currentPlayer(table)?.id !== table.heroId) return [];
  return getLegalActions(table.state, table.heroId);
}

export function advanceToHero(table, limit = 240) {
  let steps = 0;
  while (!table.ended && steps < limit) {
    steps += 1;
    const { state } = table;
    if (state.status === 'showdown' || state.status === 'complete') {
      finishIfReady(table);
      continue;
    }
    if (state.pendingDeal && state.toAct === null) {
      dealNextStreet(state);
      continue;
    }
    const player = currentPlayer(table);
    if (!player) break;
    if (player.id === table.heroId) break;
    const decision = chooseBotAction(table, player);
    if (!decision) break;
    const strategyStatus = decision.strategyEvidence?.status || 'approximate';
    table.strategyStats[strategyStatus] = (table.strategyStats[strategyStatus] || 0) + 1;
    const actionStreet = state.street;
    act(state, { playerId: player.id, type: decision.type, to: decision.to });
    table.botActions.push({ street: actionStreet, playerId: player.id, type: decision.type, to: decision.to, pot: getPot(state), strategyStatus, strategyAction: decision.strategyAction || decision.type, strategyProbability: decision.strategyProbability ?? null, strategyConfidence: decision.strategyConfidence ?? null, strategyNodeId: decision.strategyEvidence?.nodeId || null });
  }
  if (steps >= limit) throw new Error('TRAINING_TABLE_STEP_LIMIT');
  return table;
}

export function applyHeroAction(table, { type, to } = {}) {
  if (table.ended) return table;
  const player = currentPlayer(table);
  if (!player || player.id !== table.heroId) throw new Error('HERO_NOT_TO_ACT');
  act(table.state, { playerId: table.heroId, type, to });
  return advanceToHero(table);
}

export function syncTrainingTable(table) {
  const state = table.state;
  const icmStacks = table.tournament ? state.players.map(player => Number((player.stack + player.committedTotal).toFixed(2))) : null;
  return {
    street: state.street,
    board: [...state.board],
    pot: state.status === 'settled' ? state.settledPot || 0 : getPot(state),
    toAct: currentPlayer(table)?.position || null,
    hero: [...(heroPlayer(table)?.holeCards || [])],
    heroStack: heroPlayer(table)?.stack || 0,
    players: state.players.map(player => ({
      id: player.id,
      position: player.position,
      stack: player.stack,
      status: player.status,
      holeCards: [...(player.holeCards || [])],
      botStyle: player.botStyle,
      botProfile: player.isHero ? null : botProfile(player.botStyle),
    })),
    result: state.result || null,
    payouts: state.payouts || null,
    strategyStats: { ...(table.strategyStats || {}) },
    icm: table.tournament && Array.isArray(table.tournament.payouts) ? { ...calculateICM(icmStacks, table.tournament.payouts), heroIndex: state.players.findIndex(player => player.id === table.heroId), mode: 'tournament' } : null,
    ended: table.ended,
    actionLog: [...state.actionLog],
  };
}
