import { PROFILE_VERSION } from './version.mjs';

export const REPLAY_VERSION = 'replay-v1';
export const REPLAY_STREETS = Object.freeze(['preflop', 'flop', 'turn', 'river']);
export const REPLAY_ACTIONS = Object.freeze(['fold', 'check', 'call', 'bet', 'raise', 'jam', 'all-in', 'small-blind', 'big-blind']);

const finite = value => Number.isFinite(Number(value));
const numberOr = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
const round = value => Number(numberOr(value).toFixed(2));

function cloneCards(value) {
  return Array.isArray(value) ? value.map(card => String(card)).filter(Boolean).slice(0, 5) : [];
}

function normalizeSnapshot(snapshot = {}) {
  return {
    street: REPLAY_STREETS.includes(snapshot.street) ? snapshot.street : 'preflop',
    board: cloneCards(snapshot.board),
    pot: round(snapshot.pot),
    toCall: round(snapshot.toCall),
    heroStack: round(snapshot.heroStack),
    villainStack: round(snapshot.villainStack),
  };
}

function normalizeEvent(event = {}, index = 0) {
  const action = String(event.action || event.type || '').toLowerCase();
  const normalized = {
    seq: Number.isInteger(Number(event.seq)) ? Number(event.seq) : index + 1,
    actor: String(event.actor || event.playerId || 'unknown'),
    action,
    street: REPLAY_STREETS.includes(event.street) ? event.street : 'preflop',
    amount: round(event.amount),
  };
  for (const key of ['potBefore', 'potAfter', 'toCallBefore', 'toCallAfter', 'heroStackBefore', 'heroStackAfter', 'villainStackBefore', 'villainStackAfter']) {
    if (finite(event[key])) normalized[key] = round(event[key]);
  }
  if (Array.isArray(event.boardBefore)) normalized.boardBefore = cloneCards(event.boardBefore);
  if (Array.isArray(event.boardAfter)) normalized.boardAfter = cloneCards(event.boardAfter);
  if (event.stacksBefore && typeof event.stacksBefore === 'object') normalized.stacksBefore = { ...event.stacksBefore };
  if (event.stacksAfter && typeof event.stacksAfter === 'object') normalized.stacksAfter = { ...event.stacksAfter };
  if (event.forced === true) normalized.forced = true;
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fnv1a(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function payloadForFingerprint(tape) {
  const { fingerprint, ...payload } = tape || {};
  return payload;
}

export function fingerprintReplayTape(tape = {}) {
  return `fnv1a-${fnv1a(canonical(payloadForFingerprint(tape)))}`;
}

function initialFromHand(hand, events) {
  const first = events[0] || {};
  return normalizeSnapshot({
    street: first.street || hand.street,
    board: first.boardBefore || hand.initialBoard || [],
    pot: first.potBefore ?? hand.initialPot ?? hand.pot,
    toCall: first.toCallBefore ?? hand.initialToCall ?? hand.toCall,
    heroStack: first.heroStackBefore ?? hand.initialStack ?? hand.heroStack,
    villainStack: first.villainStackBefore ?? hand.initialVillainStack ?? hand.villainStack,
  });
}

function finalFromHand(hand, events) {
  const last = events.at(-1) || {};
  return normalizeSnapshot({
    street: hand.street || last.street,
    board: last.boardAfter || hand.board || [],
    pot: last.potAfter ?? hand.pot,
    toCall: last.toCallAfter ?? hand.toCall,
    heroStack: last.heroStackAfter ?? hand.heroStack,
    villainStack: last.villainStackAfter ?? hand.villainStack,
  });
}

/**
 * Converts the saved hand representation into a deterministic, serializable
 * replay tape. The tape does not contain strategy answers; it is only the
 * observable action/state trail used by the review UI.
 */
export function replayTapeFromHand(hand = {}) {
  const events = (hand.actionLog || hand.decisions || []).map(normalizeEvent);
  return createReplayTape({
    seed: hand.seed || hand.id || 'imported-hand',
    scenario: hand.scenario || 'imported',
    tableMode: hand.tableMode || '6max',
    heroPosition: hand.pos || '',
    villainPosition: hand.villainPos || '',
    result: hand.result || '',
    hero: hand.hero || [],
    initial: initialFromHand(hand, events),
    events,
    final: finalFromHand(hand, events),
  });
}

export function createReplayTape(input = {}) {
  const events = (input.events || input.actionLog || []).map(normalizeEvent);
  const tape = {
    version: REPLAY_VERSION,
    profileVersion: PROFILE_VERSION,
    seed: String(input.seed || 'unknown-seed'),
    context: {
      scenario: String(input.scenario || 'random'),
      tableMode: String(input.tableMode || '6max'),
      heroPosition: String(input.heroPosition || ''),
      villainPosition: String(input.villainPosition || ''),
      result: String(input.result || ''),
      hero: cloneCards(input.hero),
    },
    initial: normalizeSnapshot(input.initial),
    events,
    final: normalizeSnapshot(input.final || {}),
  };
  return { ...tape, fingerprint: fingerprintReplayTape(tape) };
}

export function validateReplayTape(tape = {}) {
  const errors = [];
  const warnings = [];
  if (tape.version !== REPLAY_VERSION) errors.push('unsupported replay version');
  if (!String(tape.seed || '').trim()) errors.push('missing seed');
  if (!tape.initial || typeof tape.initial !== 'object') errors.push('missing initial snapshot');
  if (!Array.isArray(tape.events)) errors.push('events must be an array');
  const events = Array.isArray(tape.events) ? tape.events : [];
  events.forEach((event, index) => {
    if (!Number.isInteger(event.seq) || event.seq !== index + 1) errors.push(`event ${index + 1} sequence is not contiguous`);
    if (!event.actor) errors.push(`event ${index + 1} missing actor`);
    if (!REPLAY_ACTIONS.includes(event.action)) errors.push(`event ${index + 1} has unsupported action`);
    if (!REPLAY_STREETS.includes(event.street)) errors.push(`event ${index + 1} has unsupported street`);
    if (event.boardAfter) {
      const seen = new Set();
      for (const card of event.boardAfter) {
        if (seen.has(card)) errors.push(`duplicate board card ${card}`);
        seen.add(card);
      }
    }
  });
  if (!events.length) warnings.push('replay tape contains no action events');
  if (!tape.final || typeof tape.final !== 'object') warnings.push('missing final snapshot; replay will use the last event');
  const expected = fingerprintReplayTape(tape);
  if (tape.fingerprint && tape.fingerprint !== expected) errors.push('fingerprint mismatch');
  return { valid: errors.length === 0, errors, warnings, fingerprint: expected };
}

function applyEvent(previous, event) {
  const next = { ...previous };
  next.street = event.street || previous.street;
  next.board = cloneCards(event.boardAfter || previous.board);
  if (finite(event.potAfter)) next.pot = round(event.potAfter);
  if (finite(event.toCallAfter)) next.toCall = round(event.toCallAfter);
  if (finite(event.heroStackAfter)) next.heroStack = round(event.heroStackAfter);
  if (finite(event.villainStackAfter)) next.villainStack = round(event.villainStackAfter);
  return next;
}

export function buildReplayTimeline(tape = {}) {
  const normalized = tape?.version === REPLAY_VERSION
    ? { ...tape, initial: normalizeSnapshot(tape.initial), events: (tape.events || []).map(normalizeEvent), final: normalizeSnapshot(tape.final || {}) }
    : createReplayTape(tape);
  const timeline = [{ step: 0, event: null, state: normalized.initial }];
  let state = normalized.initial;
  normalized.events.forEach((event, index) => {
    state = applyEvent(state, event);
    timeline.push({ step: index + 1, event, state });
  });
  return timeline;
}

export function replayAt(tape = {}, step = 0) {
  const timeline = buildReplayTimeline(tape);
  const index = Math.max(0, Math.min(timeline.length - 1, Number(step) || 0));
  return timeline[index];
}
