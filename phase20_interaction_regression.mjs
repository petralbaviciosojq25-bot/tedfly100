import assert from 'node:assert/strict';
import {
  BET_PRESETS,
  buildActionControls,
  buildBetModel,
  buildTablePresentation,
  calculatePotRelativeTarget,
  createHand,
  getLegalActions,
  seatLayout,
} from './core/index.mjs';

const state = createHand({
  buttonIndex: 3,
  players: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map(position => ({ id: position.toLowerCase(), position, stack: 100 })),
});
const heroId = 'utg';
const legalActions = getLegalActions(state, heroId);
const model = buildBetModel({ state, heroId, legalActions, selectedPreset: 'half' });

assert.equal(model.actionType, 'raise');
assert.equal(model.minTo, 2);
assert.equal(model.presetTargets.half, 2.25);
assert.equal(model.presetTargets.pot, 3.5);
assert.equal(model.presetTargets.max, 100);
assert.deepEqual(BET_PRESETS.map(item => item.id), ['min', 'half', 'pot', 'max']);

const controls = buildActionControls({ legalActions, betModel: model });
assert.deepEqual(controls.map(item => item.type), ['fold', 'call', 'raise']);
assert.equal(controls.filter(item => item.id === 'aggressive').length, 1);
assert.match(controls.at(-1).label, /^加注 2\.25$/);

assert.equal(calculatePotRelativeTarget({ pot: 10, currentBet: 0, streetContribution: 0, minTo: 1, maxTo: 100, fraction: 0.5 }), 5);
assert.equal(calculatePotRelativeTarget({ pot: 10, currentBet: 4, streetContribution: 1, minTo: 8, maxTo: 100, fraction: 1 }), 17);
assert.equal(seatLayout('desktop').length, 6);
assert.equal(seatLayout('mobile').length, 6);
assert.notDeepEqual(seatLayout('desktop'), seatLayout('mobile'));
assert.deepEqual(buildActionControls({ ended: true }), [{ id: 'next', type: 'next', label: '下一手', tone: 'primary' }]);
const presentation = buildTablePresentation({ table: { state, heroId, ended: false } });
assert.deepEqual(presentation.controls.map(item => item.type), ['fold', 'call', 'raise']);
assert.equal(presentation.seats.length, 5);

console.log(JSON.stringify({
  result: 'phase20 interaction regression ok',
  raiseModel: model,
  controls,
}, null, 2));
