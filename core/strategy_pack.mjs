export const STRATEGY_PACK_FORMAT = 'poker-trainer-strategy-pack/v1';
const ACTIONS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'jam', 'bet33', 'bet50', 'bet75', 'bet125', 'raise33', 'raise50', 'raise75', 'raise125']);

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function normalizeFrequencies(frequencies) {
  if (!object(frequencies)) return null;
  const rows = Object.entries(frequencies).filter(([action, value]) => ACTIONS.has(action) && finite(value) && value >= 0);
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  if (!rows.length || total <= 0) return null;
  return Object.fromEntries(rows.map(([action, value]) => [action, value / total]));
}

function validHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export function validateStrategyPack(pack) {
  const errors = [];
  if (!object(pack)) return { valid: false, errors: ['strategy pack must be an object'], nodes: [] };
  if (pack.format !== STRATEGY_PACK_FORMAT) errors.push(`format must be ${STRATEGY_PACK_FORMAT}`);
  if (!String(pack.name || '').trim()) errors.push('missing name');
  if (!String(pack.version || '').trim()) errors.push('missing version');
  if (!validHttpsUrl(pack.source?.url)) errors.push('source.url must be a valid HTTPS URL');
  if (!String(pack.source?.solver || '').trim()) errors.push('missing source.solver');
  if (pack.solution?.game !== 'NLHE') errors.push('solution.game must be NLHE');
  if (!Number.isInteger(pack.solution?.players) || pack.solution.players < 2 || pack.solution.players > 6) errors.push('solution.players must be between 2 and 6');
  if (!(Number(pack.solution?.stackBB) > 0)) errors.push('solution.stackBB must be positive');
  if (!String(pack.solution?.bettingTree || '').trim()) errors.push('missing solution.bettingTree');
  if (!object(pack.integrity) || pack.integrity.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(pack.integrity.payloadSha256 || '')) errors.push('integrity must contain a sha256 payloadSha256');
  if (!Array.isArray(pack.nodes) || !pack.nodes.length) errors.push('nodes must contain at least one node');
  const nodes = (pack.nodes || []).map((node, index) => {
    const nodeErrors = [];
    if (!object(node)) nodeErrors.push('node must be an object');
    if (!String(node?.id || '').trim()) nodeErrors.push('missing id');
    if (!object(node?.match)) nodeErrors.push('missing match');
    if (!['preflop', 'flop', 'turn', 'river'].includes(node?.match?.street)) nodeErrors.push('invalid match.street');
    if (!String(node?.match?.heroPosition || '').trim()) nodeErrors.push('missing match.heroPosition');
    if (!String(node?.match?.villainPosition || '').trim()) nodeErrors.push('missing match.villainPosition');
    const frequencies = node?.strategy?.frequencies;
    const unknownActions = object(frequencies) ? Object.keys(frequencies).filter(action => !ACTIONS.has(action)) : [];
    if (unknownActions.length) nodeErrors.push(`strategy.frequencies contains unknown actions: ${unknownActions.join(', ')}`);
    if (object(frequencies) && Object.entries(frequencies).some(([, value]) => !finite(value) || value < 0)) nodeErrors.push('strategy.frequencies contains invalid values');
    if (!normalizeFrequencies(frequencies)) nodeErrors.push('strategy.frequencies is invalid');
    nodeErrors.forEach(error => errors.push(`nodes[${index}]: ${error}`));
    return { index, node, frequencies: normalizeFrequencies(frequencies), errors: nodeErrors };
  });
  return { valid: errors.length === 0, errors, nodes };
}

function matchesTrustedAudit(pack, audits) {
  return (Array.isArray(audits) ? audits : []).some(entry =>
    String(entry?.payloadSha256 || '').toLowerCase() === String(pack?.integrity?.payloadSha256 || '').toLowerCase() &&
    (!entry.sourceUrl || entry.sourceUrl === pack.source?.url) &&
    (!entry.solver || entry.solver === pack.source?.solver) &&
    (!entry.packName || entry.packName === pack.name) &&
    (!entry.packVersion || entry.packVersion === pack.version)
  );
}

export function qualifyStrategyPack(pack, { trustedAudits = [] } = {}) {
  const verification = pack?.verification || {};
  const integrity = verification.integrityValid === true;
  // The pack's own auditTrusted flag is never enough. The registry must be supplied by a trusted verifier.
  const audited = matchesTrustedAudit(pack, trustedAudits);
  const qualified = integrity && audited && verification.qualification === 'solver-verified';
  return { integrity, audited, qualified, label: qualified ? 'solver-verified' : integrity ? 'integrity-verified' : 'unverified' };
}

function exactBoard(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((card, index) => card === right[index]);
}

export function matchStrategyNode(node, context) {
  const match = node?.match || {};
  if (match.street !== context.street || match.heroPosition !== context.heroPosition || match.villainPosition !== context.villainPosition) return null;
  if (match.players != null && Number(match.players) !== Number(context.players)) return null;
  if (match.activePlayers != null && Number(match.activePlayers) !== Number(context.activePlayers)) return null;
  if (match.potType != null && match.potType !== context.potType) return null;
  if (match.icmMode != null && Boolean(match.icmMode) !== Boolean(context.icmMode)) return null;
  if (match.facingBet != null && Boolean(match.facingBet) !== Boolean(context.facingBet)) return null;
  if (match.stackBB != null && Math.abs(Number(match.stackBB) - Number(context.stackBB)) > Number(match.stackToleranceBB ?? 0.5)) return null;
  if (match.board && !exactBoard(match.board, context.board || [])) return null;
  if (match.texture && match.texture !== context.texture) return null;
  if (match.lineKey && match.lineKey !== context.lineKey) return null;
  let specificity = 3;
  for (const key of ['players', 'activePlayers', 'potType', 'icmMode', 'facingBet', 'stackBB', 'board', 'texture', 'lineKey']) if (match[key] != null) specificity += 1;
  return { specificity, coverage: match.board || match.lineKey ? 'exact' : 'constrained' };
}

export function matchBestStrategyNode(packs, context, options = {}) {
  const candidates = [];
  for (const pack of packs || []) {
    const report = validateStrategyPack(pack);
    if (!report.valid) continue;
    const trust = qualifyStrategyPack(pack, options);
    for (const item of report.nodes) {
      const match = matchStrategyNode(item.node, context);
      if (match) candidates.push({ pack, node: item.node, frequencies: item.frequencies, match, trust });
    }
  }
  candidates.sort((left, right) => right.match.specificity - left.match.specificity || Number(right.trust.qualified) - Number(left.trust.qualified));
  return candidates[0] || null;
}

export function strategyEvidence(packs, context, options = {}) {
  const match = matchBestStrategyNode(packs, context, options);
  if (!match) return { status: 'approximate', confidence: 0.1, label: 'approximate strategy - node not covered', match: null };
  if (!match.trust.qualified) return { status: 'unverified', confidence: 0.25, label: 'matched strategy pack is not externally audited', match };
  return { status: 'verified', confidence: match.match.coverage === 'exact' ? 1 : 0.85, label: `solver-verified: ${match.pack.name}`, match };
}
