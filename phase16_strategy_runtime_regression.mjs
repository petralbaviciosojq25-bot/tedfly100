import assert from 'node:assert/strict';
import {
  applyHeroAction,
  createSixMaxTrainingTable,
  legalHeroActions,
  syncTrainingTable,
} from './core/index.mjs';

let resolverCalls = 0;
const verifiedResolver = ({ legal, state, player }) => {
  resolverCalls += 1;
  assert.ok(Array.isArray(legal) && legal.length > 0, 'resolver must receive legal actions');
  assert.ok(state.street === 'preflop', 'the first bot decision should be preflop');
  assert.ok(player.position, 'resolver must receive the acting position');
  return {
    status: 'verified',
    label: 'test solver node',
    nodeId: 'test-preflop-node',
    frequencies: { fold: 0.25, call: 0.75 },
  };
};

let mixed = { fold: 0, call: 0 };
for (let handNo = 0; handNo < 40; handNo += 1) {
  const table = createSixMaxTrainingTable({
    seed: `phase16-mixed-${handNo}`,
    heroPosition: 'BTN',
    stack: 100,
    strategyResolver: verifiedResolver,
  });
  assert.ok(table.strategyStats.verified > 0, 'verified nodes must be counted');
  assert.equal(table.strategyStats.approximate || 0, 0, 'verified resolver must not fall back');
  for (const action of table.botActions) {
    assert.equal(action.strategyStatus, 'verified');
    assert.equal(action.strategyNodeId, 'test-preflop-node');
    assert.ok(['fold', 'call'].includes(action.strategyAction));
    assert.ok(action.strategyProbability > 0);
    mixed[action.strategyAction] += 1;
  }
  while (!table.ended) {
    const legal = legalHeroActions(table);
    assert.ok(legal.length, 'hero must keep a legal action until the hand ends');
    applyHeroAction(table, { type: 'fold' });
  }
}
assert.ok(mixed.fold > 0 && mixed.call > 0, 'verified frequencies must produce both actions across seeds');
assert.ok(resolverCalls >= 40, 'resolver must be called for bot decisions');

const unverifiedTable = createSixMaxTrainingTable({
  seed: 'phase16-unverified',
  heroPosition: 'BTN',
  stack: 100,
  strategyResolver: () => ({
    status: 'unverified',
    label: 'unverified test pack',
    frequencies: { fold: 1 },
    nodeId: 'untrusted-node',
  }),
});
assert.ok(unverifiedTable.strategyStats.unverified > 0, 'unverified nodes must be counted');
assert.equal(unverifiedTable.strategyStats.verified || 0, 0, 'unverified data must never be treated as solver verified');
assert.ok(unverifiedTable.botActions.every(action => action.strategyStatus === 'unverified'), 'unverified frequencies must not drive bot actions');
assert.equal(syncTrainingTable(unverifiedTable).strategyStats.unverified, unverifiedTable.strategyStats.unverified);

console.log(JSON.stringify({
  result: 'phase16 strategy runtime regression ok',
  verifiedBotActions: Object.values(mixed).reduce((sum, value) => sum + value, 0),
  mixedActions: mixed,
  resolverCalls,
  unverifiedNodes: unverifiedTable.strategyStats.unverified,
}, null, 2));
