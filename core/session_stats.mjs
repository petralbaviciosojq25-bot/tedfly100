import { PROFILE_VERSION } from './version.mjs';

export const SESSION_STATS_VERSION = 'session-stats-v2';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const ACTION_KEYS = ['fold', 'check', 'call', 'bet', 'raise', 'jam'];
const finite = value => Number.isFinite(Number(value));

function canonicalAction(value) {
  const action = String(value || '').toLowerCase();
  if (action === 'all-in' || action === 'allin' || action === 'jam') return 'jam';
  if (action.startsWith('raise')) return 'raise';
  if (action.startsWith('bet')) return 'bet';
  if (['fold', 'check', 'call'].includes(action)) return action;
  return action || null;
}

function actionInFrequency(decision = {}) {
  const action = canonicalAction(decision.action);
  const optimal = canonicalAction(decision.optimal);
  if (action && optimal && action === optimal) return true;
  const probability = Number(decision.probability ?? decision.strategy?.[decision.action]);
  return Number.isFinite(probability) && probability >= 0.15;
}

/**
 * Reclassifies a saved decision from its current action/strategy data.
 * Stored prose labels are only a fallback for imported rows without structure;
 * this prevents an old label from surviving after the decision data changed.
 */
export function classifyDecisionError(decision = {}) {
  const action = canonicalAction(decision.action);
  const optimal = canonicalAction(decision.optimal);
  if (actionInFrequency(decision)) return null;
  if (action && optimal) {
    if (action === 'call' && optimal !== 'call') return 'overcall';
    if (action === 'fold' && optimal !== 'fold') return 'overfold';
    if (['bet', 'raise', 'jam'].includes(action) && !['bet', 'raise'].includes(optimal)) return 'overbluff';
  }
  const error = String(decision.error || '');
  if (/overcall|过度跟注/i.test(error)) return 'overcall';
  if (/overfold|过度弃牌/i.test(error)) return 'overfold';
  if (/overbluff|过度诈唬/i.test(error)) return 'overbluff';
  return null;
}

function decisionRows(session) {
  return (Array.isArray(session?.history) ? session.history : []).flatMap(hand =>
    (Array.isArray(hand?.decisions) ? hand.decisions : []).map((decision, index) => ({
      ...decision,
      handId: hand.id,
      decisionIndex: index,
    }))
  );
}

function emptyStats() {
  return {
    decisions: 0,
    total: 0,
    good: 0,
    evLoss: 0,
    actions: Object.fromEntries(ACTION_KEYS.map(action => [action, 0])),
    streets: Object.fromEntries(STREET_ORDER.map(street => [street, { n: 0, score: 0 }])),
    errors: { overcall: 0, overfold: 0, overbluff: 0 },
    spots: {},
    vpip: 0,
    pfr: 0,
  };
}

function spotKey(decision) {
  if (!STREET_ORDER.includes(decision.street) || !decision.position) return null;
  return [decision.street, decision.position, decision.texture || '—', decision.facing ? 'facing' : 'no-pressure'].join('|');
}

function rebuildFromHistory(session) {
  const stats = emptyStats();
  const rows = decisionRows(session);
  const scored = rows.filter(row => finite(row.score));

  for (const row of rows) {
    const action = canonicalAction(row.action);
    if (ACTION_KEYS.includes(action)) stats.actions[action] += 1;
    const error = classifyDecisionError(row);
    if (error) stats.errors[error] += 1;

    const key = spotKey(row);
    if (!key) continue;
    const spot = stats.spots[key] || { n: 0, score: 0, evLoss: 0, actions: {} };
    if (finite(row.score)) {
      spot.n += 1;
      spot.score += Number(row.score);
    }
    if (finite(row.evLoss)) spot.evLoss += Math.max(0, Number(row.evLoss));
    if (action) spot.actions[action] = (spot.actions[action] || 0) + 1;
    stats.spots[key] = spot;
  }

  for (const row of scored) {
    const score = Number(row.score);
    stats.decisions += 1;
    stats.total += score;
    if (score >= 80) stats.good += 1;
    if (finite(row.evLoss)) stats.evLoss += Math.max(0, Number(row.evLoss));
    if (STREET_ORDER.includes(row.street)) {
      stats.streets[row.street].n += 1;
      stats.streets[row.street].score += score;
    }
  }

  for (const hand of Array.isArray(session?.history) ? session.history : []) {
    const first = (hand.decisions || []).find(decision => decision.street === 'preflop');
    if (!first) continue;
    if (canonicalAction(first.action) !== 'fold') stats.vpip += 1;
    if (['bet', 'raise', 'jam'].includes(canonicalAction(first.action))) stats.pfr += 1;
  }

  return { stats, rows };
}

/**
 * Migrates persisted session data without discarding hand history. Rebuilding
 * is deterministic and safe to run on every load, so stale aggregate fields
 * and stale labels cannot survive a refresh or an imported hand-history load.
 */
export function rebuildSessionStats(input = {}) {
  const session = input && typeof input === 'object' ? input : {};
  const history = Array.isArray(session.history) ? session.history : [];
  if (!history.length) {
    return {
      ...session,
      statsVersion: SESSION_STATS_VERSION,
      profileVersion: PROFILE_VERSION,
    };
  }

  const { stats, rows } = rebuildFromHistory(session);
  // Some very old imported snapshots contain only action + score and have no
  // optimal/probability/error evidence. Keep their recorded leak totals until
  // a decision-level signal exists; otherwise there is no honest basis for
  // inventing a new classification.
  const hasErrorEvidence = rows.some(row => row.optimal != null || row.probability != null || row.error != null);
  if (!hasErrorEvidence) stats.errors = { ...emptyStats().errors, ...(session.errors || {}) };
  const persistedHands = finite(session.hands) ? Number(session.hands) : 0;
  return {
    ...session,
    ...stats,
    hands: Math.max(history.length, persistedHands),
    imported: Number(session.imported || 0),
    history,
    profile: null,
    statsVersion: SESSION_STATS_VERSION,
    profileVersion: PROFILE_VERSION,
  };
}
