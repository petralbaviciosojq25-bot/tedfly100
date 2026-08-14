import { EV_VERSION } from './version.mjs';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const numeric = (value, name) => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || typeof value === 'boolean') throw new TypeError(`${name} must be a finite number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a finite number`);
  return parsed;
};

export function callEV({ equity, potBeforeCall, toCall }) {
  const e = clamp(numeric(equity, 'equity'), 0, 1);
  const pot = Math.max(0, numeric(potBeforeCall, 'potBeforeCall'));
  const cost = Math.max(0, numeric(toCall, 'toCall'));
  return Number((e * (pot + cost) - cost).toFixed(4));
}

export function betEV({ pot, wager, foldEquity = 0, equityWhenCalled = 0.5 }) {
  const p = Math.max(0, numeric(pot, 'pot'));
  const bet = Math.max(0, numeric(wager, 'wager'));
  const fold = clamp(numeric(foldEquity, 'foldEquity'), 0, 1);
  const equity = clamp(numeric(equityWhenCalled, 'equityWhenCalled'), 0, 1);
  return Number((fold * p + (1 - fold) * (equity * (p + 2 * bet) - bet)).toFixed(4));
}

export function compareActionEV(actionEV) {
  const entries = Object.entries(actionEV || {})
    .map(([action, value]) => [action, value === null || value === undefined || (typeof value === 'string' && value.trim() === '') ? NaN : Number(value)])
    .filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return { bestAction: null, bestEV: null, actionEV: {} };
  const best = entries.reduce((current, entry) => entry[1] > current[1] ? entry : current);
  return { bestAction: best[0], bestEV: best[1], actionEV: Object.fromEntries(entries) };
}

export function scoreDecision({ chosenEV, bestEV, referencePot = 1, confidence = 1, source = 'approximate' } = {}) {
  const chosen = chosenEV === null || chosenEV === undefined || (typeof chosenEV === 'string' && chosenEV.trim() === '') ? NaN : Number(chosenEV);
  const best = bestEV === null || bestEV === undefined || (typeof bestEV === 'string' && bestEV.trim() === '') ? NaN : Number(bestEV);
  if (!Number.isFinite(chosen) || !Number.isFinite(best)) return { version: EV_VERSION, score: null, evLoss: null, confidence, source, status: 'unscored' };
  const evLoss = Math.max(0, Number((best - chosen).toFixed(4)));
  const normalizedLoss = evLoss / Math.max(1, Math.abs(Number(referencePot) || 1));
  const score = Math.round(clamp(100 - normalizedLoss * 120, 0, 100));
  return {
    version: EV_VERSION,
    score,
    evLoss,
    normalizedLoss: Number(normalizedLoss.toFixed(4)),
    confidence: clamp(Number(confidence), 0, 1),
    source,
    status: source === 'solver-verified' ? 'verified' : 'approximate',
  };
}
