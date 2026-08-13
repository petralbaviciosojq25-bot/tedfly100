import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./gto_engine.js', import.meta.url), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'gto_engine.js' });
const engine = context.window.GTO_ENGINE;

assert.equal(typeof engine.preflopSizeTree, 'function');
for (const facing of [false, true]) {
  const tree = engine.preflopSizeTree({ hand: 'AKs', pos: 'BTN', facing });
  const sum = tree.actionKeys.reduce((n, key) => n + tree[key], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `preflop tree must normalize: ${sum}`);
  assert.ok(tree.actionKeys.length >= 3);
}

const strategy = engine.strategyFor({ hand: 'QJs', pos: 'CO', facing: false });
assert.ok(strategy.sizeTree);
assert.equal(strategy.sizeTree.facing, false);

const defense = engine.postflopDefenseTree({ equity: .46, pot: 80, toCall: 40, street: 'turn', pos: 'BB', draw: true, bot: 'pressure' });
const defenseSum = defense.actionKeys.reduce((n, key) => n + defense[key], 0);
assert.ok(Math.abs(defenseSum - 1) < 1e-9, `defense tree must normalize: ${defenseSum}`);
assert.ok(defense.sizes.some(x => x.key === 'jam'));

console.log('phase6 regression ok');
