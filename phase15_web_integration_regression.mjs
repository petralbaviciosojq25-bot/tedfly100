import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from './core/index.mjs';

const here = new URL('.', import.meta.url);
const html = fs.readFileSync(new URL('./texas_holdem_trainer.html', here), 'utf8');
const engine = fs.readFileSync(new URL('./gto_engine.js', here), 'utf8');
const mainMatch = html.match(/<script>\s*\nconst R='23456789TJQKA'[\s\S]*?<\/script>/);
const phase13Match = html.match(/<script>\s*\n\/\* Phase 13: single-layout poker room[\s\S]*?<\/script>/);
const runtimeBridgeMatch = html.match(/<script>\s*\nwindow\.__POKER_TRAINER__=[\s\S]*?<\/script>/);
const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(mainMatch && phase13Match && runtimeBridgeMatch && moduleMatch, 'trainer script blocks must exist');

const mainScript = mainMatch[0].replace(/^<script>\s*/, '').replace(/<\/script>$/, '');
const phase13Script = phase13Match[0].replace(/^<script>\s*/, '').replace(/<\/script>$/, '');
const runtimeBridgeScript = runtimeBridgeMatch[0].replace(/^<script>\s*/, '').replace(/<\/script>$/, '');
const moduleScript = moduleMatch[1].replace(/^\s*import \* as CORE[^;]+;\s*/, 'const CORE=POKER_CORE_TEST;');
assert.doesNotMatch(moduleScript, /const equity=hand\.board\.length\?0\.5:0\.5/, 'web adapter must not use fixed 50% equity');
assert.doesNotMatch(moduleScript, /newBtn.*addEventListener|tableMode.*addEventListener|scenario.*addEventListener/, 'web adapter must not double-bind controls');
assert.match(moduleScript, /estimateHeroEquity/, 'web adapter must consume core equity');
assert.match(moduleScript, /scenario:scenarioKey/, 'web adapter must preserve the selected scenario');
assert.match(moduleScript, /coreStrategyResolver/, 'web adapter must define a strategy-pack resolver');
assert.match(moduleScript, /strategyResolver:coreStrategyResolver/, 'web adapter must connect the resolver to the six-max table');
assert.match(moduleScript, /coreStrategyStats/, 'web adapter must preserve strategy evidence counts');
assert.match(moduleScript, /botStrategyStats/, 'web adapter must persist strategy evidence in hand history');
assert.match(html, /core\/index\.mjs\?v=29/, 'module cache version must be current');
assert.match(html, /serviceWorker\.register\('\.\/sw\.js\?v=29'\)/, 'service worker version must be current');

class FakeElement {
  constructor(id = '') {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.className = ''; this.value = '';
    this.style = {}; this.dataset = {}; this.onclick = null; this.onchange = null; this.listeners = new Map();
    this.classList = { add() {}, remove() {}, contains() { return false; } };
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  querySelector(selector) { return this.children.get(selector) || (this.children.set(selector, new FakeElement(selector)), this.children.get(selector)); }
  querySelectorAll() { return []; }
  appendChild(node) { return node; }
  insertAdjacentHTML() {}
  insertAdjacentElement() {}
  before() {}
  get children() { this._children ??= new Map(); return this._children; }
}

const elements = new Map();
const get = id => elements.get(id) || (elements.set(id, new FakeElement(id)), elements.get(id));
const document = {
  getElementById: get,
  querySelector(selector) { return get(selector.replace(/^#/, '')); },
  querySelectorAll() { return []; },
  createElement(tag) { return new FakeElement(tag); },
  head: new FakeElement('head'),
  body: new FakeElement('body'),
};
get('tableMode').value = '6max';
get('scenario').value = 'random';
const store = new Map();
const localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
const context = { console, document, localStorage, location: { protocol: 'http:', origin: 'http://localhost:8787' }, Math, JSON, Date, Set, Map, Object, Array, Number, String, Boolean, RegExp, Error, Promise, fetch: async () => ({ ok: false, json: async () => ({}) }), alert() {}, setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, POKER_CORE_TEST: CORE };
context.window = context;
vm.createContext(context);
vm.runInContext(engine, context, { filename: 'gto_engine.js' });
vm.runInContext(mainScript, context, { filename: 'texas_holdem_trainer.html' });
vm.runInContext(phase13Script, context, { filename: 'phase13-trainer.html' });
vm.runInContext(runtimeBridgeScript, context, { filename: 'runtime-bridge.js' });
vm.runInContext(moduleScript, context, { filename: 'core-web-adapter.mjs' });

const trainer = source => vm.runInContext(source, context, { filename: 'phase15-runner' });
const runtime = () => trainer('__POKER_TRAINER__.getRuntime()');
assert.equal(context.POKER_CORE_STATUS, 'ready');
assert.equal(runtime().G.hand.coreMode, true, 'random 6-max must use the core table');

let completed = 0;
const scenarioCounts = { random: 0, adaptive: 0 };
for (let handNo = 0; handNo < 60; handNo += 1) {
  const scenario = handNo % 2 ? 'adaptive' : 'random';
  get('scenario').value = scenario;
  get('seedInput').value = `phase15-${handNo}`;
  trainer('window.newHand()');
  const hand = runtime().G.hand;
  scenarioCounts[scenario] += 1;
  assert.equal(hand.coreMode, true);
  assert.equal(hand.scenario, scenario, 'selected scenario must survive core hand creation');
  assert.notEqual(hand.villainPos, hand.pos, 'displayed opponent position must not be the hero position');
  assert.ok(Number.isFinite(hand.lastEquity) && hand.lastEquity >= 0 && hand.lastEquity <= 1, 'equity must be numeric');
  assert.ok(hand.coreEquity?.method, 'equity method must be recorded');
  if (hand.coreTable.botActions.length) assert.ok((hand.coreStrategyStats?.approximate || 0) > 0, 'without a verified pack, bot nodes must be labelled approximate');
  assert.equal(new Set(hand.corePlayers.filter(player => player.id !== hand.coreTable.heroId).map(player => player.botStyle)).size, 4, 'all four bot styles must be present');

  let steps = 0;
  while (!runtime().G.done && steps < 12) {
    const current = runtime().G.hand;
    const legal = CORE.legalHeroActions(current.coreTable);
    assert.ok(legal.length, 'core hand must expose a legal hero action');
    const action = legal.find(item => item.type === 'check') || legal.find(item => item.type === 'call') || legal.find(item => item.type === 'fold') || legal[0];
    const actionJson = JSON.stringify(action.type);
    trainer(`window.act(${actionJson})`);
    assert.ok(current.decisions.length >= steps + 1, 'each core action must be recorded');
    steps += 1;
  }
  if (!runtime().G.done) trainer("window.act('fold')");
  assert.equal(runtime().G.done, true, `hand ${handNo + 1} must finish`);
  assert.ok(runtime().G.session.history[0].botStrategyStats, 'strategy evidence counts must be stored in history');
  completed += 1;
}

assert.equal(runtime().G.session.hands, completed, 'completed-hand count must not drift');

context.STRATEGY_PACKS = {
  FORMAT: 'poker-trainer-strategy-pack/v1',
  contextFromHand: hand => ({ ...hand, players: 6, texture: '' }),
  matchBest: () => ({
    trust: { qualified: true },
    pack: { name: 'browser-fixture-pack', version: '1.0.0', source: { solver: 'fixture-solver' } },
    node: { id: 'browser-fixture-node' },
    frequencies: { fold: 1 },
    match: { coverage: 'constrained' },
  }),
};
runtime().G.online.packs = [{ kind: 'strategy', name: 'browser-fixture-source', version: '1.0.0' }];
let fixtureHand = null;
for (let handNo = 0; handNo < 20; handNo += 1) {
  get('seedInput').value = `phase16-browser-${handNo}`;
  trainer('window.newHand()');
  if (runtime().G.hand.coreTable.botActions.length) { fixtureHand = runtime().G.hand; break; }
}
assert.ok(fixtureHand, 'browser fixture must reach at least one bot decision');
assert.ok(fixtureHand.coreStrategyStats.verified > 0, 'browser resolver must allow verified pack frequencies');
assert.ok(fixtureHand.coreTable.botActions.every(action => action.strategyStatus === 'verified' && action.strategyNodeId === 'browser-fixture-node'), 'browser bot decisions must retain verified node evidence');
trainer("window.act('fold')");
const savedFixtureStats = runtime().G.session.history[0].botStrategyStats;
for (const key of ['verified', 'unverified', 'approximate']) assert.equal(savedFixtureStats[key] || 0, fixtureHand.coreStrategyStats[key] || 0, `browser strategy count ${key} must survive hand review`);

console.log(JSON.stringify({ result: 'phase15 web 6-max integration regression ok', completed, scenarioCounts, fixtureVerifiedNodes: fixtureHand.coreStrategyStats.verified }, null, 2));
