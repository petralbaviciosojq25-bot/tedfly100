import { classifyDecisionError } from './session_stats.mjs';

export const TRAINING_QUEUE_VERSION = 'training-queue-v1';
export const TRAINING_QUEUE_LIMIT = 8;

const STREETS = Object.freeze(['preflop', 'flop', 'turn', 'river']);
const finite = value => Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = value => Number(Number(value || 0).toFixed(2));

function focusType(decision) {
  const error = classifyDecisionError(decision);
  if (error) return error;
  if (finite(decision.evLoss) && Number(decision.evLoss) >= 2) return 'ev-loss';
  if (decision.betSize || decision.size || decision.sizingError) return 'sizing';
  if (finite(decision.probability) && Number(decision.probability) < 0.15) return 'frequency';
  return 'review';
}

function focusLabel(type) {
  return ({
    overcall: '\u8fc7\u5ea6\u8ddf\u6ce8',
    overfold: '\u8fc7\u5ea6\u5f03\u724c',
    overbluff: '\u8fc7\u5ea6\u8be5\u552c',
    'ev-loss': 'EV \u635f\u5931',
    sizing: '\u4e0b\u6ce8\u5c3a\u5ea6',
    frequency: '\u6df7\u5408\u9891\u7387',
    review: '\u8282\u70b9\u590d\u76d8',
  })[type] || '\u8282\u70b9\u590d\u76d8';
}

function scenarioFor({ type, street } = {}) {
  if (type === 'overcall' || type === 'overfold') return 'rivercatch';
  if (type === 'overbluff') return 'overbet';
  if (street === 'turn') return 'turnbarrel';
  if (street === 'flop') return 'btn3bet';
  return 'random';
}

function rowsFromSession(session = {}) {
  return (Array.isArray(session.history) ? session.history : []).flatMap(hand =>
    (Array.isArray(hand.decisions) ? hand.decisions : []).map((decision, decisionIndex) => ({
      ...decision,
      handId: hand.id,
      decisionIndex,
    }))
  );
}

function groupKey(decision) {
  const street = STREETS.includes(decision.street) ? decision.street : 'unknown';
  const position = String(decision.position || 'unknown');
  const texture = String(decision.texture || 'board');
  const pressure = decision.facing ? 'facing' : 'no-pressure';
  return [focusType(decision), street, position, texture, pressure].join('|');
}

function reasonFor(item) {
  const weakest = item.averageScore == null ? '' : '\u5e73\u5747\u5f97\u5206 ' + item.averageScore;
  const loss = item.evLoss > 0 ? '\uff0c\u7d2f\u8ba1 EV \u635f\u5931 ' + item.evLoss + ' BB' : '';
  const miss = item.errorCount > 0 ? '\uff0c\u7ed3\u6784\u6027\u504f\u5dee ' + item.errorCount + ' \u6b21' : '';
  return weakest + loss + miss + '\u3002\u4e0b\u4e00\u6b65\u91cd\u590d ' + Math.max(3, Math.min(8, item.sampleSize + 2)) + ' \u6b21\u540c\u7c7b\u8282\u70b9\u3002';
}

function priorityFor(item) {
  const scorePenalty = item.averageScore == null ? 25 : (100 - item.averageScore) * 0.65;
  const errorPenalty = item.errorCount * 9;
  const evPenalty = Math.min(30, item.evLoss * 4);
  const sampleConfidence = Math.min(18, item.sampleSize * 2);
  return round(clamp(scorePenalty + errorPenalty + evPenalty - sampleConfidence, 0, 100));
}

function createEmptyTask() {
  return {
    id: 'baseline|all',
    type: 'review',
    label: '\u5efa\u7acb\u8bad\u7ec3\u6837\u672c',
    title: '\u5148\u5b8c\u6210\u51e0\u624b\u5b8c\u6574\u724c\u5c40',
    reason: '\u5f53\u524d\u8fd8\u6ca1\u6709\u8db3\u591f\u7684\u51b3\u7b56\u6570\u636e\u3002\u5148\u7528\u968f\u673a\u724c\u5c40\u5efa\u7acb\u57fa\u7ebf\u3002',
    scenario: 'random',
    street: 'preflop',
    position: '',
    texture: '',
    sampleSize: 0,
    averageScore: null,
    errorCount: 0,
    evLoss: 0,
    priority: 20,
    sourceHandIds: [],
    sourceDecisionIndexes: [],
  };
}

export function buildTrainingQueue(session = {}, { limit = TRAINING_QUEUE_LIMIT } = {}) {
  const rows = rowsFromSession(session);
  if (!rows.length) return [createEmptyTask()];
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    const current = groups.get(key) || {
      key,
      type: focusType(row),
      street: STREETS.includes(row.street) ? row.street : 'unknown',
      position: String(row.position || ''),
      texture: String(row.texture || ''),
      sampleSize: 0,
      scoreTotal: 0,
      scored: 0,
      errorCount: 0,
      evLoss: 0,
      sourceHandIds: new Set(),
      sourceDecisionIndexes: [],
    };
    current.sampleSize += 1;
    if (finite(row.score)) {
      current.scoreTotal += Number(row.score);
      current.scored += 1;
    }
    if (classifyDecisionError(row)) current.errorCount += 1;
    if (finite(row.evLoss)) current.evLoss += Math.max(0, Number(row.evLoss));
    if (row.handId != null) current.sourceHandIds.add(row.handId);
    current.sourceDecisionIndexes.push({ handId: row.handId, decisionIndex: row.decisionIndex });
    groups.set(key, current);
  }
  return [...groups.values()]
    .map(group => {
      const averageScore = group.scored ? round(group.scoreTotal / group.scored) : null;
      const item = {
        id: group.key,
        type: group.type,
        label: focusLabel(group.type),
        title: focusLabel(group.type) + ' · ' + group.street + (group.position ? ' · ' + group.position : ''),
        reason: '',
        scenario: scenarioFor(group),
        street: group.street,
        position: group.position,
        texture: group.texture,
        sampleSize: group.sampleSize,
        averageScore,
        errorCount: group.errorCount,
        evLoss: round(group.evLoss),
        priority: 0,
        sourceHandIds: [...group.sourceHandIds],
        sourceDecisionIndexes: group.sourceDecisionIndexes,
      };
      item.priority = priorityFor(item);
      item.reason = reasonFor(item);
      return item;
    })
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, Number(limit) || TRAINING_QUEUE_LIMIT));
}

export function selectNextTrainingTask(session = {}, { excludeScenario = '' } = {}) {
  const queue = buildTrainingQueue(session);
  return queue.find(task => task.scenario !== excludeScenario) || queue[0] || createEmptyTask();
}

export function summarizeTrainingQueue(session = {}) {
  const queue = buildTrainingQueue(session);
  return {
    version: TRAINING_QUEUE_VERSION,
    total: queue.length,
    urgent: queue.filter(item => item.priority >= 55).length,
    top: queue[0] || createEmptyTask(),
    types: Object.fromEntries(queue.reduce((counts, item) => {
      counts.set(item.type, (counts.get(item.type) || 0) + 1);
      return counts;
    }, new Map())),
  };
}
