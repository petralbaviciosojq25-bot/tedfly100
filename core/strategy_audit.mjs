import { matchBestStrategyNode, qualifyStrategyPack, validateStrategyPack } from './strategy_pack.mjs';

export const STRATEGY_AUDIT_VERSION = 'strategy-audit-v1';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numberOr = (value, fallback = null) => finite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, clean(value[key])]));
  return value;
}

/** A stable, human-readable node key used by reports and replay fixtures. */
export function strategyContextKey(context = {}) {
  const board = Array.isArray(context.board) ? context.board.join(',') : '';
  return [
    context.street || '',
    context.heroPosition || '',
    context.villainPosition || '',
    numberOr(context.players, ''),
    numberOr(context.activePlayers, ''),
    context.potType || '',
    context.icmMode ? 'icm' : 'cash',
    context.facingBet ? 'facing' : 'no-bet',
    numberOr(context.stackBB, ''),
    context.texture || '',
    context.lineKey || '',
    board,
  ].join('|');
}

function bucketKey(context = {}) {
  return [context.street || 'unknown', context.heroPosition || 'unknown', context.potType || 'unknown', context.icmMode ? 'icm' : 'cash'].join('|');
}

function contextFromDecision(decision = {}) {
  const source = decision.strategyEvidence?.context || decision.context || {};
  return {
    ...source,
    street: source.street || decision.street,
    heroPosition: source.heroPosition || decision.position,
    villainPosition: source.villainPosition || decision.villainPosition || decision.villainPos,
    texture: source.texture || decision.texture,
    facingBet: source.facingBet ?? decision.facing,
    lineKey: source.lineKey || decision.lineKey || '',
    scenario: decision.scenario || source.scenario || '',
  };
}

/** Extracts the contexts actually encountered by the player, preserving repeats. */
export function strategyContextsFromSession(session = {}) {
  return (session.history || []).flatMap(hand => (hand.decisions || []).map(decision => ({
    ...contextFromDecision(decision),
    handId: hand.id,
    decisionId: decision.id || `${hand.id || 'hand'}:${decision.street || 'street'}:${decision.action || 'action'}`,
  }))).filter(context => context.street && context.heroPosition);
}

function statusForMatch(match) {
  if (!match) return { status: 'approximate', confidence: 0.1, coverage: 'uncovered' };
  if (!match.trust?.qualified) return { status: 'unverified', confidence: 0.25, coverage: match.match?.coverage || 'constrained' };
  return {
    status: 'verified',
    confidence: match.match?.coverage === 'exact' ? 1 : 0.85,
    coverage: match.match?.coverage || 'constrained',
  };
}

function packReport(pack, trustedAudits) {
  const validation = validateStrategyPack(pack);
  const trust = validation.valid ? qualifyStrategyPack(pack, { trustedAudits }) : { integrity: false, audited: false, qualified: false, label: 'unverified' };
  return {
    id: pack?.id || `${pack?.name || 'pack'}@${pack?.version || 'unknown'}`,
    name: pack?.name || 'unnamed pack',
    version: pack?.version || 'unknown',
    solver: pack?.source?.solver || 'unknown solver',
    sourceUrl: pack?.source?.url || '',
    payloadSha256: pack?.integrity?.payloadSha256 || null,
    nodeCount: Array.isArray(pack?.nodes) ? pack.nodes.length : 0,
    valid: validation.valid,
    errors: validation.errors.slice(0, 8),
    integrity: Boolean(trust.integrity),
    audited: Boolean(trust.audited),
    qualified: Boolean(trust.qualified),
    qualification: trust.label,
  };
}

/**
 * Audits real replay contexts against loaded packs. A zero verified count is a
 * valid result: it means the current training sample is still approximate.
 */
export function auditStrategyCoverage(packs = [], contexts = [], { trustedAudits = [] } = {}) {
  const safePacks = Array.isArray(packs) ? packs.filter(Boolean) : [];
  const safeContexts = Array.isArray(contexts) ? contexts.filter(context => context && context.street) : [];
  const rows = safeContexts.map(context => {
    const match = matchBestStrategyNode(safePacks, context, { trustedAudits });
    const evidence = statusForMatch(match);
    return {
      contextKey: strategyContextKey(context),
      bucket: bucketKey(context),
      street: context.street,
      heroPosition: context.heroPosition || null,
      villainPosition: context.villainPosition || null,
      potType: context.potType || null,
      icmMode: Boolean(context.icmMode),
      coverage: evidence.coverage,
      status: evidence.status,
      confidence: evidence.confidence,
      pack: match ? { name: match.pack.name, version: match.pack.version, solver: match.pack.source?.solver || '' } : null,
      nodeId: match?.node?.id || null,
      handId: context.handId || null,
      decisionId: context.decisionId || null,
    };
  });
  const counts = rows.reduce((summary, row) => {
    summary.total += 1;
    summary[row.status] += 1;
    if (row.coverage === 'exact') summary.exact += 1;
    else if (row.coverage === 'constrained') summary.constrained += 1;
    else summary.uncovered += 1;
    return summary;
  }, { total: 0, verified: 0, unverified: 0, approximate: 0, exact: 0, constrained: 0, uncovered: 0 });
  const group = new Map();
  for (const row of rows) {
    const value = group.get(row.bucket) || { bucket: row.bucket, total: 0, verified: 0, unverified: 0, approximate: 0, exact: 0, uncovered: 0 };
    value.total += 1;
    value[row.status] += 1;
    if (row.coverage === 'exact') value.exact += 1;
    if (row.coverage === 'uncovered') value.uncovered += 1;
    group.set(row.bucket, value);
  }
  const nodeHits = Object.values(rows.reduce((result, row) => {
    if (!row.nodeId) return result;
    const key = `${row.pack?.name || 'pack'}:${row.nodeId}`;
    const value = result[key] || { key, pack: row.pack, nodeId: row.nodeId, hits: 0, verified: 0, unverified: 0, approximate: 0 };
    value.hits += 1;
    value[row.status] += 1;
    result[key] = value;
    return result;
  }, {})).sort((left, right) => right.hits - left.hits || left.key.localeCompare(right.key));
  const uncoveredContexts = rows.filter(row => row.status === 'approximate').slice(0, 100);
  return {
    version: STRATEGY_AUDIT_VERSION,
    sample: { contexts: safeContexts.length, distinctContexts: new Set(rows.map(row => row.contextKey)).size },
    counts,
    verifiedCoverage: counts.total ? Number((counts.verified / counts.total).toFixed(4)) : 0,
    exactCoverage: counts.total ? Number((counts.exact / counts.total).toFixed(4)) : 0,
    byBucket: [...group.values()].sort((left, right) => left.bucket.localeCompare(right.bucket)),
    packs: safePacks.map(pack => packReport(pack, trustedAudits)),
    nodeHits,
    uncoveredContexts,
    rows,
  };
}

function actionError(decision = {}) {
  const error = String(decision.error || '');
  if (/overcall|过度跟注/i.test(error) || (decision.action === 'call' && decision.optimal && decision.optimal !== 'call')) return 'overcall';
  if (/overfold|过度弃牌/i.test(error) || (decision.action === 'fold' && decision.optimal && decision.optimal !== 'fold')) return 'overfold';
  if (/overbluff|过度诈唬/i.test(error) || (['bet', 'raise', 'jam'].includes(decision.action) && !['bet', 'raise'].includes(decision.optimal))) return 'overbluff';
  return null;
}

function curriculumRow(decision, index) {
  const context = contextFromDecision(decision);
  const key = strategyContextKey(context) || `${decision.street || 'unknown'}|${decision.position || 'unknown'}|${decision.texture || ''}`;
  return { key, context, decision, index };
}

/** Converts session evidence into a stable, leak-weighted training curriculum. */
export function deriveTrainingCurriculum(session = {}, { limit = 6 } = {}) {
  const rows = (session.history || []).flatMap(hand => (hand.decisions || []).map(decision => curriculumRow({ ...decision, scenario: decision.scenario || hand.scenario }, hand.id)));
  const grouped = new Map();
  for (const item of rows) {
    const value = grouped.get(item.key) || {
      key: item.key,
      context: item.context,
      samples: 0,
      scoreTotal: 0,
      scored: 0,
      evLoss: 0,
      errors: { overcall: 0, overfold: 0, overbluff: 0 },
      evidence: { verified: 0, unverified: 0, approximate: 0 },
      scenarios: {},
    };
    value.samples += 1;
    if (finite(Number(item.decision.score))) { value.scoreTotal += Number(item.decision.score); value.scored += 1; }
    if (finite(Number(item.decision.evLoss))) value.evLoss += Math.max(0, Number(item.decision.evLoss));
    const error = actionError(item.decision);
    if (error) value.errors[error] += 1;
    const status = item.decision.strategyEvidence?.status || 'approximate';
    value.evidence[status] = (value.evidence[status] || 0) + 1;
    const scenario = item.decision.scenario || item.context.scenario;
    if (scenario) value.scenarios[scenario] = (value.scenarios[scenario] || 0) + 1;
    grouped.set(item.key, value);
  }
  const targets = [...grouped.values()].map(value => {
    const averageScore = value.scored ? value.scoreTotal / value.scored : null;
    const errorTotal = Object.values(value.errors).reduce((sum, count) => sum + count, 0);
    const dominantError = Object.entries(value.errors).sort((left, right) => right[1] - left[1])[0]?.[0] || null;
    const priority = Number(clamp((averageScore == null ? 25 : 100 - averageScore) + errorTotal * 12 + value.evLoss * 2 + (value.evidence.approximate > 0 ? 4 : 0), 0, 100).toFixed(2));
    const scenario = Object.entries(value.scenarios).sort((left, right) => right[1] - left[1])[0]?.[0] || value.context.scenario || null;
    return {
      key: value.key,
      context: value.context,
      samples: value.samples,
      averageScore: averageScore == null ? null : Number(averageScore.toFixed(2)),
      evLoss: Number(value.evLoss.toFixed(3)),
      errors: value.errors,
      dominantError,
      evidence: value.evidence,
      scenario,
      priority,
      reason: dominantError ? `${dominantError} appears in this node` : averageScore == null ? 'unscored node needs review' : `average score ${Math.round(averageScore)}`,
    };
  }).sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key)).slice(0, Math.max(1, limit));
  const decisions = rows.length;
  const confidence = Math.round((1 - Math.exp(-decisions / 35)) * 100);
  const nextFocus = targets[0] || null;
  return {
    version: STRATEGY_AUDIT_VERSION,
    sample: { hands: Number(session.hands || session.history?.length || 0), decisions },
    confidence,
    nextFocus,
    targets,
  };
}

/** Deterministic target selection for replay and regression tests. */
export function chooseCurriculumTarget(curriculum, seed = 'curriculum') {
  const targets = curriculum?.targets || [];
  if (!targets.length) return null;
  let hash = 2166136261;
  for (const char of String(seed)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return targets[Math.abs(hash) % targets.length];
}
