import assert from 'node:assert/strict';
import {
  BOT_PROFILES,
  calculateICM,
  createSixMaxTrainingTable,
  icmDecisionValue,
  summarizePlayerProfile,
  syncTrainingTable,
  tournamentPressure,
} from './core/index.mjs';

const twoPlayer = calculateICM([50, 30], [0.6, 0.4]);
assert.equal(twoPlayer.method, 'exact-icm');
assert.ok(Math.abs(twoPlayer.equity[0] - 0.525) < 0.000001, 'two-player ICM must account for finish order');
assert.ok(Math.abs(twoPlayer.equity.reduce((sum, value) => sum + value, 0) - 1) < 0.000001, 'ICM equities must sum to the full prize pool');

const decision = icmDecisionValue({
  stacks: [50, 30, 20],
  payouts: [0.5, 0.3, 0.2],
  heroIndex: 0,
  lossAmount: 10,
  winAmount: 20,
  winProbability: 0.55,
  loseProbability: 0.45,
});
assert.ok(Number.isFinite(decision.value) && Number.isFinite(decision.bubbleFactor), 'ICM decision value and bubble factor must be numeric');
assert.ok(decision.bubbleFactor >= 0, 'bubble factor must not be negative');
assert.match(tournamentPressure({ stacks: [50, 30, 20], payouts: [0.5, 0.3, 0.2], heroIndex: 0, lossAmount: 10, winAmount: 20 }).label, /压力/);

const tournament = createSixMaxTrainingTable({
  seed: 'phase17-tournament',
  heroPosition: 'BTN',
  stack: 100,
  tournament: { payouts: [0.5, 0.3, 0.2] },
});
const synced = syncTrainingTable(tournament);
assert.equal(synced.icm.mode, 'tournament');
assert.equal(synced.icm.equity.length, 6);
assert.ok(synced.players.some(player => player.botProfile?.label === BOT_PROFILES.pressure.label), 'bot archetype metadata must be exposed after the style upgrade');

const session = {
  hands: 12,
  errors: { overcall: 3, overfold: 1, overbluff: 0 },
  history: Array.from({ length: 12 }, (_, id) => ({
    id: id + 1,
    decisions: [{ street: id % 3 === 0 ? 'turn' : 'preflop', action: id % 2 ? 'call' : 'raise', score: id % 2 ? 55 : 85, evLoss: id % 2 ? 0.25 : 0.02 }],
  })),
};
const profile = summarizePlayerProfile(session);
const emptyProfile = summarizePlayerProfile({ history: [] });
assert.equal(emptyProfile.rating, null, 'empty sample must not receive a numeric rating');
assert.equal(emptyProfile.grade, '—', 'empty sample must be explicitly marked as sample period');
assert.equal(emptyProfile.confidence, 0);
assert.equal(profile.version, 'player-profile-v1');
assert.equal(profile.decisions, 12);
assert.ok(profile.confidence > 0 && profile.confidence < 100, 'player confidence must reflect sample size');
assert.ok(profile.rating >= 0 && profile.rating <= 100);
assert.ok(profile.leaks.includes('过度跟注'));
assert.ok(profile.nextFocus);

console.log(JSON.stringify({
  result: 'phase17 phases 5-9 regression ok',
  icm: twoPlayer.equity,
  bubbleFactor: decision.bubbleFactor,
  tournamentHeroICM: synced.icm.equity[synced.icm.heroIndex],
  profile: { rating: profile.rating, grade: profile.grade, confidence: profile.confidence, nextFocus: profile.nextFocus },
}, null, 2));
