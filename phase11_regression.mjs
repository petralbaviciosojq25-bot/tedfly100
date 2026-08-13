import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./texas_holdem_trainer.html',import.meta.url),'utf8');

assert.match(html,/Phase 11: collision-free table zones/);
assert.match(html,/\.seat\.hero\{display:none!important\}/);
assert.match(html,/\.hero-block\{bottom:195px;z-index:7\}/);
assert.match(html,/\.layout>aside\{display:grid;grid-template-columns:1fr;gap:10px\}/);
assert.match(html,/牌局信息/);
assert.match(html,/决策数据/);
assert.match(html,/即时复盘/);
assert.match(html,/行动区/);

console.log('phase11 regression ok');
