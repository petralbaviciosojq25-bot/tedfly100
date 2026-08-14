import { ICM_VERSION } from './version.mjs';

const finite = value => Number.isFinite(Number(value));
const cleanStacks = stacks => (Array.isArray(stacks) ? stacks : []).map(value => Math.max(0, Number(value) || 0));
const cleanPayouts = payouts => (Array.isArray(payouts) ? payouts : []).map(value => Math.max(0, Number(value) || 0));

function keyOf(indices, stacks, payouts) {
  return `${indices.join(',')}|${stacks.map(value => Number(value).toFixed(4)).join(',')}|${payouts.map(value => Number(value).toFixed(4)).join(',')}`;
}

function calculateRemaining(indices, stacks, payouts, memo) {
  if (!indices.length || !payouts.length) return Object.fromEntries(indices.map(index => [index, 0]));
  const key = keyOf(indices, stacks, payouts);
  if (memo.has(key)) return memo.get(key);
  const total = stacks.reduce((sum, value) => sum + value, 0);
  const result = Object.fromEntries(indices.map(index => [index, 0]));
  if (total <= 0) {
    const share = payouts.reduce((sum, value) => sum + value, 0) / indices.length;
    indices.forEach(index => { result[index] = share; });
    memo.set(key, result);
    return result;
  }
  indices.forEach((winnerIndex, position) => {
    const probability = stacks[position] / total;
    const restIndices = indices.filter((_, index) => index !== position);
    const restStacks = stacks.filter((_, index) => index !== position);
    const rest = calculateRemaining(restIndices, restStacks, payouts.slice(1), memo);
    result[winnerIndex] += probability * payouts[0];
    Object.entries(rest).forEach(([index, value]) => { result[index] += probability * value; });
  });
  memo.set(key, result);
  return result;
}

/**
 * Exact Independent Chip Model equity for up to six players.
 * The returned values are prize-pool shares, not chip EV.
 */
export function calculateICM(stacks, payouts) {
  const values = cleanStacks(stacks);
  const prizes = cleanPayouts(payouts);
  if (values.length < 2 || values.length > 9) throw new TypeError('ICM requires between two and nine stacks');
  if (!prizes.length) throw new TypeError('ICM requires at least one payout');
  if (values.some(value => !finite(value))) throw new TypeError('ICM stacks must be finite numbers');
  const indices = values.map((_, index) => index);
  const raw = calculateRemaining(indices, values, prizes, new Map());
  const totalPrize = prizes.reduce((sum, value) => sum + value, 0) || 1;
  const equity = values.map((_, index) => Number((raw[index] / totalPrize).toFixed(8)));
  return { version: ICM_VERSION, equity, prizeValues: values.map((_, index) => Number(raw[index].toFixed(8))), payouts: prizes, stacks: values, method: 'exact-icm' };
}

export function icmDecisionValue({ stacks, payouts, heroIndex = 0, lossAmount = 0, winAmount = 0, winProbability = 0, loseProbability = 0, tieProbability = 0 } = {}) {
  const current = calculateICM(stacks, payouts);
  if (!Number.isInteger(heroIndex) || heroIndex < 0 || heroIndex >= current.stacks.length) throw new RangeError('heroIndex is outside the stack list');
  const heroStack = current.stacks[heroIndex];
  const loseStacks = [...current.stacks];
  const winStacks = [...current.stacks];
  loseStacks[heroIndex] = Math.max(0, heroStack - Math.max(0, Number(lossAmount) || 0));
  winStacks[heroIndex] = heroStack + Math.max(0, Number(winAmount) || 0);
  const lose = calculateICM(loseStacks, payouts).equity[heroIndex];
  const win = calculateICM(winStacks, payouts).equity[heroIndex];
  const before = current.equity[heroIndex];
  const probabilities = {
    win: Math.max(0, Number(winProbability) || 0),
    lose: Math.max(0, Number(loseProbability) || 0),
    tie: Math.max(0, Number(tieProbability) || 0),
  };
  const total = probabilities.win + probabilities.lose + probabilities.tie || 1;
  const value = (probabilities.win * win + probabilities.lose * lose + probabilities.tie * before) / total;
  const reward = Math.max(0, win - before);
  const risk = Math.max(0, before - lose);
  return {
    version: ICM_VERSION,
    before,
    win,
    lose,
    value: Number(value.toFixed(8)),
    chipEV: Number(((probabilities.win * (Number(winAmount) || 0)) - (probabilities.lose * (Number(lossAmount) || 0))).toFixed(4)),
    bubbleFactor: reward > 0 ? Number((risk / reward).toFixed(4)) : null,
    pressure: Number((risk / Math.max(0.0001, before)).toFixed(4)),
    probabilities,
  };
}

export function tournamentPressure({ stacks, payouts, heroIndex = 0, lossAmount = 0, winAmount = 0 } = {}) {
  const current = calculateICM(stacks, payouts);
  const heroStack = current.stacks[heroIndex] || 0;
  const probe = icmDecisionValue({ stacks, payouts, heroIndex, lossAmount, winAmount, winProbability: 0.5, loseProbability: 0.5 });
  return {
    version: ICM_VERSION,
    heroStack,
    equity: current.equity[heroIndex] || 0,
    bubbleFactor: probe.bubbleFactor,
    pressure: probe.pressure,
    label: probe.bubbleFactor == null ? 'ICM 压力不可估计' : probe.bubbleFactor > 1.5 ? '高 ICM 压力' : probe.bubbleFactor > 1.15 ? '中等 ICM 压力' : '低 ICM 压力',
  };
}
