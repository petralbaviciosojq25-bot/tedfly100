import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rebuildSessionStats, SESSION_STATS_VERSION, summarizePlayerProfile } from './core/index.mjs';

const staleSession = {
  hands: 4,
  decisions: 4,
  total: 400,
  errors: { overcall: 0, overfold: 0, overbluff: 0 },
  history: Array.from({ length: 4 }, (_, index) => ({
    id: index + 1,
    decisions: [{
      street: 'river',
      position: 'BB',
      texture: '干燥面',
      facing: true,
      action: 'call',
      optimal: 'fold',
      probability: 0.02,
      score: 100,
      evLoss: 0.4,
      error: '主线一致',
    }],
  })),
};

const migrated = rebuildSessionStats(staleSession);
assert.equal(migrated.statsVersion, SESSION_STATS_VERSION);
assert.equal(migrated.decisions, 4);
assert.equal(migrated.total, 400);
assert.equal(migrated.errors.overcall, 4, 'old aggregate error counts must be rebuilt from decisions');
assert.equal(migrated.errors.overfold, 0);
assert.equal(migrated.spots['river|BB|干燥面|facing'].n, 4);

const profile = summarizePlayerProfile(staleSession);
assert.equal(profile.averageScore, 100);
assert.equal(profile.errors.overcall, 4);
assert.ok(profile.leaks.includes('过度跟注'), 'a perfect average must not hide a repeated structural leak');

const staleLabelButInRange = rebuildSessionStats({
  history: [{ decisions: [{ street: 'river', position: 'BB', action: 'call', optimal: 'fold', probability: 0.8, score: 100, error: '过度跟注' }] }],
});
assert.equal(staleLabelButInRange.errors.overcall, 0, 'a stale prose label must not override an in-frequency action');

const html = fs.readFileSync(new URL('./texas_holdem_trainer.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.match(html, /serviceWorker\.register\(`\.\/sw\.js\?v=\$\{version\}`/);
assert.match(html, /rebuildTrainerSessionStats/);
assert.match(html, /当前没有已通过可信审核的 Solver 节点/);
assert.match(html, /setAttribute\('aria-controls','reviewDrawer'\)/);
assert.match(html, /Phase 21: stale-stat migration/);
assert.match(sw, /poker-trainer-v37/);
assert.match(sw, /self\.skipWaiting\(\)/);
assert.match(sw, /self\.clients\.claim\(\)/);
assert.match(sw, /session_stats\.mjs/);

console.log(JSON.stringify({
  result: 'phase21 migration, cache update and accessibility regression ok',
  stats: { version: migrated.statsVersion, decisions: migrated.decisions, averageScore: profile.averageScore, overcall: profile.errors.overcall },
  solverCoverage: 'explicit approximate state when verified coverage is zero',
}, null, 2));
