import { getLegalActions } from './table_state.mjs';

const POSITION_ORDER = Object.freeze(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);

export const DESKTOP_SEAT_LAYOUT = Object.freeze({
  UTG: Object.freeze({ x: 13, y: 34 }),
  HJ: Object.freeze({ x: 50, y: 14 }),
  CO: Object.freeze({ x: 87, y: 34 }),
  BTN: Object.freeze({ x: 90, y: 64 }),
  SB: Object.freeze({ x: 72, y: 84 }),
  BB: Object.freeze({ x: 28, y: 84 }),
});

export const MOBILE_SEAT_LAYOUT = Object.freeze({
  UTG: Object.freeze({ x: 15, y: 34 }),
  HJ: Object.freeze({ x: 34, y: 15 }),
  CO: Object.freeze({ x: 66, y: 15 }),
  BTN: Object.freeze({ x: 85, y: 34 }),
  SB: Object.freeze({ x: 18, y: 63 }),
  BB: Object.freeze({ x: 82, y: 63 }),
});

export const BET_PRESETS = Object.freeze([
  Object.freeze({ id: 'min', label: '最小' }),
  Object.freeze({ id: 'half', label: '1/2 底池', fraction: 0.5 }),
  Object.freeze({ id: 'pot', label: '底池', fraction: 1 }),
  Object.freeze({ id: 'max', label: '最大' }),
]);

const roundChip = value => Number(Number(value).toFixed(2));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function formatChips(value) {
  const amount = roundChip(Number(value) || 0);
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function seatLayout(mode = 'desktop') {
  const source = mode === 'mobile' ? MOBILE_SEAT_LAYOUT : DESKTOP_SEAT_LAYOUT;
  return POSITION_ORDER.map(position => ({ position, ...source[position] }));
}

export function aggressiveAction(legalActions = []) {
  return legalActions.find(action => action.type === 'bet' || action.type === 'raise')
    || legalActions.find(action => action.type === 'all-in')
    || null;
}

export function calculatePotRelativeTarget({
  pot,
  currentBet,
  streetContribution,
  minTo,
  maxTo,
  fraction = 0.5,
  facingBet = currentBet > streetContribution,
} = {}) {
  const contribution = Math.max(0, Number(streetContribution) || 0);
  const wager = Math.max(contribution, Number(currentBet) || 0);
  const callAmount = Math.max(0, wager - contribution);
  const potBeforeAction = Math.max(0, Number(pot) || 0);
  const desired = facingBet
    ? contribution + callAmount + (potBeforeAction + callAmount) * Number(fraction || 0)
    : contribution + potBeforeAction * Number(fraction || 0);
  return roundChip(clamp(desired, Number(minTo) || 0, Number(maxTo) || 0));
}

export function buildBetModel({ state, heroId, legalActions = [], selectedPreset = 'half', selectedTarget = null } = {}) {
  if (!state || !heroId) return null;
  const player = state.players?.find(item => item.id === heroId);
  const action = aggressiveAction(legalActions);
  if (!player || !action) return null;

  const allInTo = roundChip(player.streetContribution + player.stack);
  const minTo = roundChip(action.type === 'all-in' ? allInTo : action.minTo);
  const maxTo = roundChip(action.type === 'all-in' ? allInTo : action.maxTo);
  const presetTargets = Object.fromEntries(BET_PRESETS.map(preset => {
    let target;
    if (preset.id === 'min') target = minTo;
    else if (preset.id === 'max') target = maxTo;
    else target = calculatePotRelativeTarget({
      pot: state.players.reduce((sum, item) => sum + Number(item.committedTotal || 0), 0),
      currentBet: state.currentBet,
      streetContribution: player.streetContribution,
      minTo,
      maxTo,
      fraction: preset.fraction,
    });
    return [preset.id, target];
  }));
  const fallback = presetTargets[selectedPreset] ?? presetTargets.half ?? minTo;
  const target = roundChip(clamp(selectedTarget == null ? fallback : selectedTarget, minTo, maxTo));
  const pay = roundChip(Math.max(0, target - player.streetContribution));
  return {
    actionType: action.type,
    minTo,
    maxTo,
    target,
    pay,
    selectedPreset: Object.entries(presetTargets).find(([, value]) => value === target)?.[0] || 'custom',
    presetTargets,
    presets: BET_PRESETS.map(preset => ({ ...preset, target: presetTargets[preset.id] })),
  };
}

export function buildActionControls({ legalActions = [], betModel = null, ended = false } = {}) {
  if (ended) return [{ id: 'next', type: 'next', label: '下一手', tone: 'primary' }];
  const byType = type => legalActions.find(action => action.type === type);
  const controls = [];
  if (byType('fold')) controls.push({ id: 'fold', type: 'fold', label: '弃牌', tone: 'danger' });
  const passive = byType('check') || byType('call');
  if (passive) controls.push({
    id: passive.type,
    type: passive.type,
    label: passive.type === 'check' ? '过牌' : `跟注 ${formatChips(passive.amount)}`,
    tone: 'danger',
  });
  if (betModel) controls.push({
    id: 'aggressive',
    type: betModel.actionType === 'all-in' ? 'all-in' : betModel.actionType,
    label: betModel.actionType === 'all-in'
      ? '全押'
      : `${betModel.actionType === 'bet' ? '下注' : '加注'} ${formatChips(betModel.target)}`,
    target: betModel.target,
    tone: 'danger',
  });
  return controls;
}

export function buildTablePresentation({ table, showOpponents = false, selectedPreset = 'half', selectedTarget = null } = {}) {
  if (!table?.state) return null;
  const { state, heroId } = table;
  const hero = state.players.find(player => player.id === heroId);
  const legalActions = state.status === 'active' && state.players[state.toAct]?.id === heroId
    ? table.ended ? [] : getLegalActions(state, heroId)
    : [];
  const betModel = buildBetModel({ state, heroId, legalActions, selectedPreset, selectedTarget });
  return {
    street: state.street,
    pot: roundChip(state.status === 'settled' ? state.settledPot || 0 : state.players.reduce((sum, item) => sum + Number(item.committedTotal || 0), 0)),
    hero: hero ? { id: hero.id, position: hero.position, stack: roundChip(hero.stack), cards: [...(hero.holeCards || [])] } : null,
    board: [...(state.board || [])],
    seats: state.players.filter(player => player.id !== heroId).map(player => ({
      id: player.id,
      position: player.position,
      stack: roundChip(player.stack),
      status: player.status,
      cards: showOpponents ? [...(player.holeCards || [])] : [],
      isCurrent: state.players[state.toAct]?.id === player.id,
    })),
    legalActions,
    betModel,
    controls: buildActionControls({ legalActions, betModel, ended: table.ended }),
    layouts: { desktop: DESKTOP_SEAT_LAYOUT, mobile: MOBILE_SEAT_LAYOUT },
  };
}
