import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  REPLAY_VERSION,
  buildReplayTimeline,
  act,
  createHand,
  getLegalActions,
  fingerprintReplayTape,
  replayAt,
  replayTapeFromHand,
  validateReplayTape,
} from './core/index.mjs';

const hand = {
  id: 22,
  seed: 'phase22-seed',
  scenario: 'random',
  tableMode: '6max',
  pos: 'BTN',
  villainPos: 'BB',
  initialPot: 3,
  initialToCall: 0,
  initialStack: 100,
  initialBoard: [],
  hero: ['As', 'Kd'],
  board: ['Qs', '7h', '2c'],
  pot: 9,
  toCall: 0,
  heroStack: 96,
  villainStack: 96,
  actionLog: [
    { seq: 1, actor: 'hero', action: 'raise', street: 'preflop', amount: 2.5, potBefore: 3, potAfter: 5.5, toCallBefore: 0, toCallAfter: 0, heroStackBefore: 100, heroStackAfter: 97.5, villainStackBefore: 100, villainStackAfter: 100, boardBefore: [], boardAfter: [] },
    { seq: 2, actor: 'bot', action: 'call', street: 'preflop', amount: 2.5, potBefore: 5.5, potAfter: 8, toCallBefore: 2.5, toCallAfter: 0, heroStackBefore: 97.5, heroStackAfter: 97.5, villainStackBefore: 100, villainStackAfter: 97.5, boardBefore: [], boardAfter: [] },
    { seq: 3, actor: 'bot', action: 'check', street: 'flop', amount: 0, potBefore: 8, potAfter: 8, toCallBefore: 0, toCallAfter: 0, heroStackBefore: 97.5, heroStackAfter: 97.5, villainStackBefore: 97.5, villainStackAfter: 97.5, boardBefore: [], boardAfter: ['Qs', '7h', '2c'] },
  ],
};

const tape = replayTapeFromHand(hand);
const validation = validateReplayTape(tape);
assert.equal(tape.version, REPLAY_VERSION);
assert.equal(validation.valid, true, validation.errors.join(', '));
assert.equal(validation.fingerprint, fingerprintReplayTape(tape));

const timeline = buildReplayTimeline(tape);
assert.equal(timeline.length, 4);
assert.equal(timeline[0].state.pot, 3);
assert.equal(timeline[1].state.pot, 5.5);
assert.deepEqual(timeline[3].state.board, ['Qs', '7h', '2c']);
assert.equal(replayAt(tape, 99).step, 3);
assert.equal(replayAt(tape, -2).step, 0);

const broken = { ...tape, events: tape.events.map((event, index) => index === 1 ? { ...event, seq: 9 } : event) };
assert.equal(validateReplayTape(broken).valid, false);

const coreState = createHand({
  buttonIndex: 0,
  players: [{ id: 'a', position: 'BTN', stack: 100 }, { id: 'b', position: 'BB', stack: 100 }],
});
const coreActor = coreState.players[coreState.toAct];
assert.ok(getLegalActions(coreState, coreActor.id).some(action => action.type === 'fold'));
act(coreState, { playerId: coreActor.id, type: 'fold' });
const coreEvent = coreState.actionLog.at(-1);
assert.equal(coreEvent.potBefore, 1.5);
assert.equal(coreEvent.potAfter, 1.5);
assert.deepEqual(coreEvent.boardBefore, []);
assert.deepEqual(coreEvent.stacksBefore, { a: 99.5, b: 99 });

const html = fs.readFileSync(new URL('./texas_holdem_trainer.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
assert.match(html, /core\/replay\.mjs\?v=37/);
assert.match(html, /phase22-replay-panel/);
assert.match(html, /data-replay-index/);
assert.match(sw, /poker-trainer-v37/);
assert.match(sw, /\.\/core\/replay\.mjs/);

console.log(JSON.stringify({
  result: 'phase22 replay regression ok',
  fingerprint: tape.fingerprint,
  events: tape.events.length,
  timeline: timeline.length,
  validation,
}, null, 2));
