import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveTrainingCurriculum, summarizePlayerProfile } from './core/index.mjs';

const smallSample = summarizePlayerProfile({
  hands: 12,
  errors: { overcall: 0, overfold: 0, overbluff: 0 },
  history: Array.from({ length: 12 }, (_, id) => ({
    id,
    decisions: [{ street: 'preflop', action: 'fold', score: 100, probability: 0.99, optimal: 'fold' }],
  })),
});
assert.equal(smallSample.rating, null, 'small samples must remain in sample period');
assert.equal(smallSample.leaks.length, 0, 'a strong street must not be called weak without a score threshold');

const reliableSample = summarizePlayerProfile({
  hands: 30,
  history: Array.from({ length: 30 }, (_, id) => ({ id, decisions: [{ street: 'preflop', action: 'fold', score: 75, probability: 0.7, optimal: 'fold' }] })),
});
assert.ok(Number.isFinite(reliableSample.rating), 'reliable samples should receive a numeric training rating');

const mixedFrequency = deriveTrainingCurriculum({
  hands: 1,
  history: [{ id: 1, decisions: [{
    street: 'preflop', position: 'BTN', villainPosition: 'BB', action: 'fold', optimal: 'call', score: 82, probability: 0.17,
  }] }],
});
assert.equal(mixedFrequency.nextFocus.errors.overfold, 0, 'valid mixed actions must not become overfold leaks');
assert.equal(mixedFrequency.nextFocus.dominantError, null, 'zero-error nodes must not invent a dominant leak');

const html = fs.readFileSync(new URL('./texas_holdem_trainer.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.match(html, /money=x=>\{const n=Number\(x\)/);
assert.match(html, /hand\.actionLog=view\.actionLog\.filter\(item=>!item\.forced\)/);
assert.match(html, /core\/index\.mjs\?v=33/);
assert.match(sw, /poker-trainer-v33/);
assert.match(html, /\.table\{isolation:isolate/);

console.log(JSON.stringify({
  result: 'phase19 acceptance regression ok',
  smallSample: { rating: smallSample.rating, confidence: smallSample.confidence, leaks: smallSample.leaks },
  reliableSample: { rating: reliableSample.rating, confidence: reliableSample.confidence },
  mixedFrequency: mixedFrequency.nextFocus,
}, null, 2));
