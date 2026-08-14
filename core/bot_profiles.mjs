export const BOT_PROFILES = Object.freeze({
  solver: Object.freeze({ id: 'solver', label: '近似平衡型', description: '以范围纪律和混合频率为主，不代表真实 Solver。', pressure: 0, foldThreshold: 0.31, raiseThreshold: 0.72 }),
  pressure: Object.freeze({ id: 'pressure', label: '高压进攻型', description: '提高主动下注、再加注和边缘施压频率。', pressure: 0.12, foldThreshold: 0.27, raiseThreshold: 0.67 }),
  sticky: Object.freeze({ id: 'sticky', label: '粘性跟注型', description: '减少弃牌，更多用跟注实现摊牌。', pressure: -0.08, foldThreshold: 0.22, raiseThreshold: 0.72 }),
  trapper: Object.freeze({ id: 'trapper', label: '陷阱型', description: '强牌更常延迟加速，保留慢打和诱导线路。', pressure: -0.03, foldThreshold: 0.31, raiseThreshold: 0.76 }),
});

export const BOT_PROFILE_IDS = Object.freeze(Object.keys(BOT_PROFILES));

export function botProfile(id = 'solver') {
  return BOT_PROFILES[id] || BOT_PROFILES.solver;
}
