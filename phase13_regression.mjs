import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('./texas_holdem_trainer.html',import.meta.url),'utf8');
const entry=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');

assert.match(html,/Phase 13: single-layout poker room/);
assert.match(html,/document\.querySelectorAll\('\.client-bet-rail'\)\.forEach\(rail=>rail\.remove\(\)\)/);
assert.match(html,/actions\.parentElement===table\)table\.insertAdjacentElement\('afterend',actions\)/);
assert.match(html,/analytics-room-header/);
assert.match(html,/玩家画像/);
assert.match(html,/id='tab-profile'/);
assert.match(html,/id="startFocus"/);
assert.match(html,/const correctedFinish=window\.finish/);
assert.match(html,/G\.session\.history=\[newest,\.\.\.historyBefore\]\.slice\(0,200\)/);
assert.match(html,/G\.session\.pfr=pfrBefore\+1/);
assert.match(html,/return; \/\/ Replaced by the single-source Phase 13 layout below\./);
assert.match(html,/register\('\.\/sw\.js\?v=14'\)/);
assert.match(sw,/poker-trainer-v14/);
assert.match(entry,/location\.replace\('\.\/texas_holdem_trainer\.html\?v=14'\)/);
assert.match(entry,/href="\.\/texas_holdem_trainer\.html\?v=14"/);

console.log('phase13 regression ok');
