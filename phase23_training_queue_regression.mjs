import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TRAINING_QUEUE_VERSION,
  buildTrainingQueue,
  selectNextTrainingTask,
  summarizeTrainingQueue,
} from './core/index.mjs';

const session = {
  history: [
    {
      id: 'h-river',
      decisions: [
        { street: 'river', position: 'BB', texture: 'paired', facing: true, action: 'call', optimal: 'fold', probability: 0.08, score: 30, evLoss: 7.2 },
        { street: 'river', position: 'BB', texture: 'paired', facing: true, action: 'call', optimal: 'fold', probability: 0.1, score: 45, evLoss: 4.4 },
      ],
    },
    {
      id: 'h-turn',
      decisions: [
        { street: 'turn', position: 'BTN', texture: 'wet', facing: true, action: 'raise', optimal: 'call', probability: 0.06, score: 55, evLoss: 2.1 },
      ],
    },
  ],
};

const queue = buildTrainingQueue(session);
assert.equal(queue[0].type, 'overcall');
assert.equal(queue[0].scenario, 'rivercatch');
assert.equal(queue[0].sampleSize, 2);
assert.equal(queue[0].errorCount, 2);
assert.ok(queue[0].priority > queue[1].priority);
assert.equal(selectNextTrainingTask(session).id, queue[0].id);
assert.equal(selectNextTrainingTask(session, { excludeScenario: 'rivercatch' }).scenario, 'overbet');

const empty = buildTrainingQueue({ history: [] });
assert.equal(empty.length, 1);
assert.equal(empty[0].scenario, 'random');
assert.equal(summarizeTrainingQueue(session).version, TRAINING_QUEUE_VERSION);

const html = fs.readFileSync(new URL('./texas_holdem_trainer.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.match(html, /training_queue\.mjs\?v=37/);
assert.match(html, /phase23-training-queue/);
assert.match(sw, /poker-trainer-v37/);
assert.match(sw, /\.\/core\/training_queue\.mjs/);
assert.equal(pkg.scripts['test:phase23'], 'node phase23_training_queue_regression.mjs');

console.log(JSON.stringify({
  result: 'phase23 training queue regression ok',
  version: TRAINING_QUEUE_VERSION,
  queueSize: queue.length,
  topTask: { type: queue[0].type, scenario: queue[0].scenario, priority: queue[0].priority },
}, null, 2));
