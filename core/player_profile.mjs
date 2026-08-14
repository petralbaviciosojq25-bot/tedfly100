import { PROFILE_VERSION } from './version.mjs';
import { rebuildSessionStats } from './session_stats.mjs';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const MIN_RATING_DECISIONS = 30;
const MIN_STREET_DECISIONS = 3;
const WEAK_STREET_SCORE = 70;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function decisionsFromSession(session) {
  return (session?.history || []).flatMap(hand => (hand.decisions || []).map(decision => ({ ...decision, handId: hand.id })));
}

function gradeFor(rating) {
  if (rating >= 90) return { grade: 'A', label: '强劲稳定' };
  if (rating >= 80) return { grade: 'B', label: '扎实进步' };
  if (rating >= 68) return { grade: 'C', label: '基础形成' };
  if (rating >= 52) return { grade: 'D', label: '需要系统训练' };
  return { grade: 'E', label: '正在建立基础' };
}

/** Produces a sample-aware player rating; it is a training estimate, not a bankroll result. */
export function summarizePlayerProfile(session = {}) {
  const normalized = rebuildSessionStats(session);
  const decisions = decisionsFromSession(normalized);
  const hands = Number(normalized.hands || normalized.history?.length || 0);
  const scores = decisions.map(item => Number(item.score)).filter(Number.isFinite);
  const evLoss = decisions.map(item => Number(item.evLoss)).filter(Number.isFinite);
  const street = Object.fromEntries(STREET_ORDER.map(key => {
    const rows = decisions.filter(item => item.street === key).map(item => Number(item.score)).filter(Number.isFinite);
    return [key, { decisions: rows.length, averageScore: Number(mean(rows).toFixed(2)) }];
  }));
  const actions = decisions.reduce((counts, item) => { counts[item.action] = (counts[item.action] || 0) + 1; return counts; }, {});
  const errors = {
    overcall: Number(normalized.errors?.overcall || 0),
    overfold: Number(normalized.errors?.overfold || 0),
    overbluff: Number(normalized.errors?.overbluff || 0),
  };
  const avgScore = Number(mean(scores).toFixed(2));
  const averageEVLoss = Number(mean(evLoss).toFixed(4));
  const errorRate = (errors.overcall + errors.overfold + errors.overbluff) / Math.max(1, decisions.length);
  const discipline = clamp(100 - errorRate * 100, 0, 100);
  const hasReliableSample = decisions.length >= MIN_RATING_DECISIONS;
  const rating = hasReliableSample
    ? Math.round(clamp(avgScore * 0.72 + discipline * 0.18 + (scores.length && avgScore >= 80 ? 10 : 0), 0, 100))
    : null;
  const confidence = Math.round((1 - Math.exp(-decisions.length / 35)) * 100);
  const grade = hasReliableSample ? gradeFor(rating) : { grade: '—', label: '样本期' };
  const weakStreet = Object.entries(street).filter(([, value]) => value.decisions >= MIN_STREET_DECISIONS && value.averageScore < WEAK_STREET_SCORE).sort((left, right) => left[1].averageScore - right[1].averageScore)[0]?.[0] || null;
  const leaks = [
    errors.overcall > 2 ? '过度跟注' : null,
    errors.overfold > 2 ? '过度弃牌' : null,
    errors.overbluff > 2 ? '过度诈唬' : null,
    weakStreet ? `${weakStreet}圈平均分偏低` : null,
  ].filter(Boolean).slice(0, 4);
  const strengths = Object.entries(street).filter(([, value]) => value.decisions > 0).sort((left, right) => right[1].averageScore - left[1].averageScore).slice(0, 2).map(([key]) => `${key}圈决策`);
  return {
    version: PROFILE_VERSION,
    hands,
    decisions: decisions.length,
    rating,
    confidence,
    grade: grade.grade,
    label: grade.label,
    averageScore: avgScore,
    averageEVLoss,
    discipline: Number(discipline.toFixed(2)),
    errorRate: Number(errorRate.toFixed(4)),
    actions,
    errors,
    street,
    strengths,
    leaks,
    nextFocus: leaks[0] || (weakStreet ? `${weakStreet}圈` : '继续积累翻前与翻后样本'),
    confidenceNote: confidence < 35 ? '样本较少，评级仅供训练方向参考。' : confidence < 70 ? '样本正在形成，建议按位置和街道继续积累。' : '样本量足以观察稳定的训练倾向。',
  };
}
