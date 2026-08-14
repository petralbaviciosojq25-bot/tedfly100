import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  STRATEGY_AUDIT_VERSION,
  auditStrategyCoverage,
  chooseCurriculumTarget,
  deriveTrainingCurriculum,
  strategyContextKey,
  strategyContextsFromSession,
} from './core/index.mjs';

const stable = value => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
    : value;
const payload = pack => {
  const clone = JSON.parse(JSON.stringify(pack));
  for (const key of ['integrity', 'verification', 'id', 'kind', 'quality', 'updatedAt', 'items', 'fetchedFrom']) delete clone[key];
  return stable(clone);
};
const digest = pack => crypto.createHash('sha256').update(JSON.stringify(payload(pack))).digest('hex');

const makePack = ({ name, url, node, solver = 'Regression Solver' }) => {
  const pack = {
    format: 'poker-trainer-strategy-pack/v1',
    name,
    version: '1.0.0',
    source: { url, solver, exportedAt: '2026-08-14T00:00:00Z' },
    solution: { game: 'NLHE', players: 6, stackBB: 100, bettingTree: 'preflop open and river response' },
    audit: { status: 'unverified' },
    integrity: { algorithm: 'sha256', payloadSha256: '' },
    nodes: [node],
  };
  pack.integrity.payloadSha256 = digest(pack);
  pack.verification = { integrityValid: true, qualification: 'solver-verified' };
  return pack;
};

const exactNode = {
  id: 'verified-btn-vs-bb',
  match: { street: 'flop', heroPosition: 'BTN', villainPosition: 'BB', players: 6, activePlayers: 2, potType: 'heads-up', facingBet: true, stackBB: 100, board: ['As', 'Kd', '2c'] },
  strategy: { frequencies: { fold: 0.2, call: 0.6, raise75: 0.2 }, evBB: { fold: 0.1, call: 1.2, raise75: 0.8 } },
};
const unverifiedNode = {
  id: 'unverified-co-vs-bb',
  match: { street: 'turn', heroPosition: 'CO', villainPosition: 'BB', players: 6, activePlayers: 3, potType: 'multiway', facingBet: true, stackBB: 100 },
  strategy: { frequencies: { fold: 0.5, call: 0.5 } },
};
const verifiedPack = makePack({ name: 'verified-fixture', url: 'https://example.org/verified.json', node: exactNode });
const unverifiedPack = makePack({ name: 'unverified-fixture', url: 'https://example.org/unverified.json', node: unverifiedNode });
unverifiedPack.verification = { integrityValid: true, qualification: 'integrity-verified' };

const trustedAudits = [{
  payloadSha256: verifiedPack.integrity.payloadSha256,
  sourceUrl: verifiedPack.source.url,
  solver: verifiedPack.source.solver,
  packName: verifiedPack.name,
  packVersion: verifiedPack.version,
}];
const contexts = [
  { street: 'flop', heroPosition: 'BTN', villainPosition: 'BB', players: 6, activePlayers: 2, potType: 'heads-up', facingBet: true, stackBB: 100, board: ['As', 'Kd', '2c'], handId: 1 },
  { street: 'turn', heroPosition: 'CO', villainPosition: 'BB', players: 6, activePlayers: 3, potType: 'multiway', facingBet: true, stackBB: 100, handId: 2 },
  { street: 'river', heroPosition: 'SB', villainPosition: 'BB', players: 6, activePlayers: 2, potType: 'heads-up', facingBet: true, stackBB: 100, handId: 3 },
];
const report = auditStrategyCoverage([verifiedPack, unverifiedPack], contexts, { trustedAudits });
assert.equal(report.version, STRATEGY_AUDIT_VERSION);
assert.deepEqual(report.counts, { total: 3, verified: 1, unverified: 1, approximate: 1, exact: 1, constrained: 1, uncovered: 1 });
assert.ok(Math.abs(report.verifiedCoverage - 1 / 3) < 0.0001);
assert.equal(report.rows[0].nodeId, 'verified-btn-vs-bb');
assert.equal(report.rows[0].coverage, 'exact');
assert.equal(report.rows[1].status, 'unverified');
assert.equal(report.rows[2].status, 'approximate');
assert.equal(report.uncoveredContexts.length, 1);
assert.ok(strategyContextKey(contexts[0]).includes('flop|BTN|BB'));

const session = {
  hands: 3,
  history: [
    { id: 1, scenario: 'rivercatch', decisions: [
      { street: 'river', position: 'BB', villainPosition: 'BTN', texture: 'dry', facing: true, action: 'call', optimal: 'fold', score: 30, evLoss: 1.4, error: '过度跟注', strategyEvidence: { status: 'approximate' } },
      { street: 'river', position: 'BB', villainPosition: 'BTN', texture: 'dry', facing: true, action: 'call', optimal: 'fold', score: 40, evLoss: 1.1, error: '过度跟注', strategyEvidence: { status: 'approximate' } },
    ] },
    { id: 2, scenario: 'btn3bet', decisions: [
      { street: 'preflop', position: 'BTN', villainPosition: 'BB', texture: '', facing: false, action: 'raise', optimal: 'raise', score: 92, evLoss: 0.02, strategyEvidence: { status: 'approximate' } },
    ] },
  ],
};
const curriculum = deriveTrainingCurriculum(session);
assert.equal(strategyContextsFromSession(session).length, 3);
assert.equal(curriculum.nextFocus.dominantError, 'overcall');
assert.equal(curriculum.nextFocus.scenario, 'rivercatch');
assert.equal(chooseCurriculumTarget(curriculum, 'same-seed').key, chooseCurriculumTarget(curriculum, 'same-seed').key);

const html = fs.readFileSync(new URL('./texas_holdem_trainer.html', import.meta.url), 'utf8');
assert.match(html, /Phase 18: strategy coverage audit/);
assert.match(html, /data-tab="audit"/);
assert.match(html, /未覆盖节点/);

console.log(JSON.stringify({
  result: 'phase18 strategy audit regression ok',
  audit: { counts: report.counts, verifiedCoverage: report.verifiedCoverage, uncovered: report.uncoveredContexts.length },
  curriculum: { confidence: curriculum.confidence, nextFocus: curriculum.nextFocus.key, scenario: curriculum.nextFocus.scenario },
}, null, 2));
