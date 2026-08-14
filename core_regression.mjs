import assert from 'node:assert/strict';
import { act, applyHeroAction, betEV, buildPots, callEV, compareActionEV, createHand, createSixMaxTrainingTable, dealHand, dealNextStreet, enumerateEquity, evaluate, getCallAmount, getLegalActions, getMinRaiseTo, legalHeroActions, RuleError, runoutDeck, scoreDecision, syncTrainingTable, validateStrategyPack, matchBestStrategyNode, strategyEvidence } from './core/index.mjs';

function throwsCode(fn, code) {
  assert.throws(fn, error => error instanceof RuleError && error.code === code);
}

const headsUp = createHand({
  players: [{ id: 'hero', position: 'BTN', stack: 100 }, { id: 'villain', position: 'BB', stack: 100 }],
  blinds: { small: 1, big: 2 },
});
assert.equal(headsUp.toAct, 0, 'heads-up button must act first preflop');
assert.equal(headsUp.pot, 3);
assert.deepEqual(getLegalActions(headsUp, 'hero').map(item => item.type), ['fold', 'call', 'raise', 'all-in']);
assert.equal(getMinRaiseTo(headsUp, 'hero'), 4);
throwsCode(() => dealNextStreet(headsUp), 'STREET_NOT_READY');

act(headsUp, { playerId: 'hero', type: 'raise', to: 6 });
assert.equal(headsUp.currentBet, 6);
assert.equal(getCallAmount(headsUp, 'villain'), 4);
throwsCode(() => act(headsUp, { playerId: 'villain', type: 'raise', to: 8 }), 'BELOW_MINIMUM_RAISE');
act(headsUp, { playerId: 'villain', type: 'call' });
assert.equal(headsUp.street, 'flop');
assert.equal(headsUp.toAct, null, 'postflop action waits until the flop is dealt');
assert.equal(headsUp.pendingDeal, true);

const illegalRaise = createHand({
  players: [{ id: 'hero', position: 'BTN', stack: 100 }, { id: 'villain', position: 'BB', stack: 100 }],
  blinds: { small: 1, big: 2 },
});
act(illegalRaise, { playerId: 'hero', type: 'raise', to: 6 });
throwsCode(() => act(illegalRaise, { playerId: 'villain', type: 'raise', to: 4 }), 'BELOW_MINIMUM_RAISE');
assert.equal(illegalRaise.players[1].stack, 98, 'illegal action must not change chips');

const table = createHand({
  players: [
    { id: 'utg', position: 'UTG', stack: 100 },
    { id: 'hj', position: 'HJ', stack: 100 },
    { id: 'co', position: 'CO', stack: 100 },
    { id: 'btn', position: 'BTN', stack: 100 },
    { id: 'sb', position: 'SB', stack: 100 },
    { id: 'bb', position: 'BB', stack: 100 },
  ],
  buttonIndex: 3,
  blinds: { small: 1, big: 2 },
});
assert.equal(table.players[0].id, 'utg');
assert.equal(table.toAct, 0, 'UTG must act first in a six-max hand');
act(table, { playerId: 'utg', type: 'fold' });
act(table, { playerId: 'hj', type: 'fold' });
act(table, { playerId: 'co', type: 'raise', to: 6 });
act(table, { playerId: 'btn', type: 'fold' });
act(table, { playerId: 'sb', type: 'fold' });
assert.equal(table.toAct, 5);
act(table, { playerId: 'bb', type: 'call' });
assert.equal(table.street, 'flop');
assert.equal(table.toAct, null, 'postflop action waits until the flop is dealt');
assert.equal(table.pendingDeal, true);

const sidePotTable = createHand({
  players: [{ id: 'a', position: 'BTN', stack: 10 }, { id: 'b', position: 'SB', stack: 20 }, { id: 'c', position: 'BB', stack: 40 }],
  blinds: { small: 1, big: 2 },
});
sidePotTable.players.forEach((item, index) => { item.committedTotal = [10, 20, 40][index]; item.status = index === 2 ? 'active' : 'all-in'; });
assert.deepEqual(buildPots(sidePotTable).map(pot => [pot.amount, pot.eligible]), [[30, ['a', 'b', 'c']], [20, ['b', 'c']], [20, ['c']]]);

const shortAllIn = createHand({
  players: [
    { id: 'a', position: 'BTN', stack: 100 },
    { id: 'b', position: 'SB', stack: 7 },
    { id: 'c', position: 'BB', stack: 100 },
  ],
  blinds: { small: 1, big: 2 },
});
act(shortAllIn, { playerId: 'a', type: 'raise', to: 6 });
act(shortAllIn, { playerId: 'b', type: 'all-in' });
act(shortAllIn, { playerId: 'c', type: 'call' });
assert.equal(getLegalActions(shortAllIn, 'a').some(item => item.type === 'all-in'), false, 'a short all-in must not reopen an earlier player\'s raising rights');
throwsCode(() => act(shortAllIn, { playerId: 'a', type: 'all-in' }), 'ILLEGAL_ACTION');

const shortFacingBet = createHand({
  players: [{ id: 'a', position: 'BTN', stack: 5 }, { id: 'b', position: 'SB', stack: 100 }, { id: 'c', position: 'BB', stack: 100 }],
  blinds: { small: 1, big: 2 },
});
act(shortFacingBet, { playerId: 'a', type: 'all-in' });
const shortFacingLegal = getLegalActions(shortFacingBet, 'b');
assert.equal(shortFacingLegal.some(item => item.type === 'raise' && item.minTo > item.maxTo), false, 'an impossible raise must not appear in legal actions');

const equity = enumerateEquity({ hero: ['As', 'Ad'], opponents: [['Kc', 'Kd']], board: ['Qh', 'Jc', 'Ts', '2d', '3h'] });
assert.equal(equity.runouts, 1);
assert.equal(equity.equity, 1, 'AA must beat KK on a completed board where both ranks are known');
assert.deepEqual(evaluate(['As', 'Ad', 'Qh', 'Jc', 'Ts']), [1, 14, 12, 11, 10]);

const score = scoreDecision({ chosenEV: -1.011, bestEV: 21.285, referencePot: 58, source: 'approximate' });
assert.equal(score.score, 54, 'score must reflect the 22.296BB EV loss instead of treating frequency as correctness');
assert.equal(score.status, 'approximate');
assert.equal(compareActionEV({ fold: '9', call: '10' }).bestAction, 'call', 'EV comparison must compare numeric values, not strings');
assert.equal(scoreDecision({ chosenEV: null, bestEV: null }).status, 'unscored', 'missing EV must remain unscored');
assert.equal(callEV({ equity: 0.4, potBeforeCall: 10, toCall: 2 }), 2.8);
assert.equal(betEV({ pot: 10, wager: 5, foldEquity: 0.5, equityWhenCalled: 0.5 }), 7.5);

const pack = {
  format: 'poker-trainer-strategy-pack/v1',
  name: 'Core regression pack',
  version: '1.0.0',
  source: { url: 'https://example.org/solver.json', solver: 'Regression Solver' },
  solution: { game: 'NLHE', players: 6, stackBB: 100, bettingTree: 'river 75% bet' },
  integrity: { algorithm: 'sha256', payloadSha256: 'a'.repeat(64) },
  nodes: [
    { id: 'river-exact', match: { players: 6, stackBB: 100, street: 'river', heroPosition: 'BB', villainPosition: 'BTN', facingBet: true, board: ['Ks', 'Qd', '7c', '2h', '2c'] }, strategy: { frequencies: { fold: 0.2, call: 0.7, raise: 0.1 } } },
    { id: 'river-constrained', match: { players: 6, stackBB: 100, street: 'river', heroPosition: 'BB', villainPosition: 'BTN', facingBet: true }, strategy: { frequencies: { fold: 0.2, call: 0.8 } } },
  ],
};
assert.equal(validateStrategyPack(pack).valid, true);
const unknownActionPack = structuredClone(pack);
unknownActionPack.nodes[0].strategy.frequencies.unknown = 1;
assert.equal(validateStrategyPack(unknownActionPack).valid, false, 'unknown strategy actions must be rejected');
const context = { players: 6, stackBB: 100, street: 'river', heroPosition: 'BB', villainPosition: 'BTN', facingBet: true, board: ['Ks', 'Qd', '7c', '2h', '2c'] };
assert.equal(matchBestStrategyNode([pack], context).node.id, 'river-exact');
assert.equal(strategyEvidence([pack], context).status, 'unverified');
pack.verification = { integrityValid: true, auditTrusted: true, qualification: 'solver-verified' };
assert.equal(strategyEvidence([pack], context).status, 'unverified', 'a pack must not self-declare a trusted audit');
const trustedAudit = [{ payloadSha256: pack.integrity.payloadSha256, sourceUrl: pack.source.url, solver: pack.source.solver, packName: pack.name, packVersion: pack.version }];
assert.equal(strategyEvidence([pack], context, { trustedAudits: trustedAudit }).status, 'verified');

const dealt = dealHand({
  seed: 'six-max-regression',
  players: [
    { id: 'utg', position: 'UTG', stack: 100 },
    { id: 'hj', position: 'HJ', stack: 100 },
    { id: 'co', position: 'CO', stack: 100 },
    { id: 'btn', position: 'BTN', stack: 100 },
    { id: 'sb', position: 'SB', stack: 100 },
    { id: 'bb', position: 'BB', stack: 100 },
  ],
  buttonIndex: 3,
  blinds: { small: 1, big: 2 },
});
assert.equal(new Set(dealt.players.flatMap(item => item.holeCards)).size, 12, 'six-max dealing must not duplicate hole cards');
assert.equal(dealt.toAct, 0);
act(dealt, { playerId: 'utg', type: 'fold' });
act(dealt, { playerId: 'hj', type: 'fold' });
act(dealt, { playerId: 'co', type: 'call' });
act(dealt, { playerId: 'btn', type: 'call' });
act(dealt, { playerId: 'sb', type: 'fold' });
act(dealt, { playerId: 'bb', type: 'check' });
assert.equal(dealt.toAct, null, 'the board must be dealt before postflop action begins');
dealNextStreet(dealt);
assert.equal(dealt.board.length, 3);
assert.equal(dealt.toAct, 5, 'the big blind is first to act postflop when still live');

const allInRunout = dealHand({
  players: [{ id: 'a', position: 'BTN', stack: 20 }, { id: 'b', position: 'BB', stack: 20 }],
  blinds: { small: 1, big: 2 },
});
act(allInRunout, { playerId: 'a', type: 'all-in' });
act(allInRunout, { playerId: 'b', type: 'call' });
runoutDeck(allInRunout);
assert.equal(allInRunout.status, 'showdown');
assert.equal(allInRunout.board.length, 5, 'all-in runout must deal flop, turn and river');

const uncontested = createHand({
  players: [{ id: 'winner', position: 'BTN', stack: 100 }, { id: 'loser', position: 'BB', stack: 100 }],
  blinds: { small: 1, big: 2 },
});
act(uncontested, { playerId: 'winner', type: 'fold' });
const uncontestedResult = (await import('./core/table_state.mjs')).settleShowdown(uncontested, {});
assert.deepEqual(uncontestedResult.payouts, { winner: 0, loser: 3 }, 'an uncontested pot must be paid to the remaining player');
assert.equal(uncontested.players.reduce((sum, item) => sum + item.stack, 0), 200);
assert.equal(uncontested.players.every(item => item.committedTotal === 0), true);

const tied = createHand({
  players: [{ id: 'a', position: 'BTN', stack: 10 }, { id: 'b', position: 'BB', stack: 10 }],
  blinds: { small: 0.5, big: 1 },
});
tied.players.forEach(item => { item.committedTotal = 1.25; item.status = 'active'; });
tied.status = 'showdown';
tied.pot = 2.5;
const tiedResult = (await import('./core/table_state.mjs')).settleShowdown(tied, { a: [1], b: [1] });
assert.deepEqual(tiedResult.payouts, { a: 1.25, b: 1.25 }, 'a fractional tied pot must not create or destroy chips');
assert.equal(tied.players.every(item => item.committedTotal === 0), true);

throwsCode(() => createHand({
  players: [{ id: 'a', stack: 10 }, { id: 'b', stack: 10 }],
  ante: -1,
}), 'INVALID_ANTE');

const sixMax = createSixMaxTrainingTable({ seed: 'six-max-training-regression', heroPosition: 'CO', stack: 100 });
assert.equal(sixMax.state.players.length, 6, 'training table must contain six seats');
assert.equal(new Set(sixMax.state.players.flatMap(player => player.holeCards)).size, 12, 'six-max training table must deal unique hole cards');
assert.equal(syncTrainingTable(sixMax).toAct, 'CO', 'bots must act until the hero position is reached');
assert.ok(legalHeroActions(sixMax).length > 0, 'hero must receive legal actions');
let sixMaxSteps = 0;
while (!sixMax.ended && sixMaxSteps < 80) {
  const legal = legalHeroActions(sixMax);
  assert.ok(legal.length, 'hero must have a legal action while the hand is live');
  const selected = legal.find(item => item.type === 'check') || legal.find(item => item.type === 'call') || legal.find(item => item.type === 'fold');
  applyHeroAction(sixMax, { type: selected.type, to: selected.to });
  sixMaxSteps += 1;
}
assert.equal(sixMax.ended, true, 'six-max training hand must finish');
assert.equal(sixMax.state.board.length, 5, 'six-max training hand must reach a complete board');
assert.equal(sixMax.state.status, 'settled');
assert.equal(sixMax.state.players.reduce((sum, player) => sum + player.stack, 0), 630, 'six-max stacks must conserve chips after settlement');

console.log(JSON.stringify({
  result: 'core rules/equity/EV regression ok',
  rules: 'legal bet, minimum raise, turn order, side pots',
  equity: `${equity.equity * 100}% exact`,
  ev: score,
}, null, 2));
