import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./gto_engine.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'gto_engine.js' });
const engine = context.window.GTO_ENGINE;

const range = engine.makeRange('BTN', false);
const updated = engine.updateRangeByAction(range, { action: 'raise', sizeKey: 'open25', street: 'preflop', pos: 'BTN', facing: false });
const total = updated.reduce((sum, item) => sum + item.weight, 0);
assert.ok(Math.abs(total - 1) < 1e-9);
assert.notEqual(engine.topRange(updated, 1)[0].hand, engine.topRange(range, 1)[0].hand);

const imported = { action: 'raise', sizeKey: 'raise125', street: 'turn', pos: 'BB', facing: true };
const postflop = engine.updateRangeByAction(range, imported);
assert.ok(Math.abs(postflop.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-9);

console.log('phase7 regression ok');
