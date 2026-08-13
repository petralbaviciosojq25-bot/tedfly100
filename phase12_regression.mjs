import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./texas_holdem_trainer.html',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');

assert.match(html,/Phase 12: poker-client workbench/);
assert.match(html,/训练数据中心/);
assert.match(html,/风格画像/);
assert.match(html,/开始本类训练/);
assert.match(html,/\.analytics-dock/);
assert.match(html,/\.table\{min-height:800px!important/);
assert.match(html,/\.seat\.hero\{display:none!important\}/);
assert.match(html,/register\('\.\/sw\.js\?v=14'\)/);
assert.match(sw,/poker-trainer-v14/);

console.log('phase12 regression ok');
