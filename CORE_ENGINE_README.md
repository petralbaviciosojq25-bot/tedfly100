# 核心牌局引擎

当前核心层已经从网页脚本中独立出来，并用于规则、发牌、权益、EV、策略包和多路训练桌。

## 模块

- `core/table_state.mjs`：NLHE 行动状态机、最小下注、最小加注、短码全押、边池、摊牌和结算。
- `core/dealer.mjs`：固定种子洗牌、6-max 发牌、烧牌、公共牌发放和全押跑牌。
- `core/cards.mjs`：五张牌和七张牌牌型评估。
- `core/equity.mjs`：已知对手手牌下的精确权益枚举。
- `core/ev.mjs`：跟注/下注 EV、动作比较和决策损失评分。
- `core/strategy_pack.mjs`：策略包格式、节点匹配、未知动作拒绝和外部审核表匹配。
- `core/icm.mjs`：精确 ICM 奖池权益、行动后决策价值、泡沫因子和赛事压力标签。
- `core/player_profile.mjs`：带样本置信度的玩家评级、街道能力、漏洞和训练重点。
- `core/bot_profiles.mjs`：四类训练化风格档案；它们是可解释 archetype，不代表真实牌手私有策略。
- `core/training_table.mjs`：随机 6-max 多路训练桌、四种近似机器人风格、机器人行动循环和多人结算适配器；支持注入策略节点解析器，按已审核频率混合采样，并记录每个机器人节点的证据等级。

## 运行测试

```powershell
npm run test:core
npm run test:phase16
npm run test:phase17
npm test
```

如果电脑没有把 Node.js 加入 PATH，可使用工作区运行时：

```powershell
C:\Users\QPF\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe core_regression.mjs
```

## 当前边界

当前没有真实 Solver 数据。策略包只有通过完整性校验并命中外部可信审核注册表时，才会标记为 `solver-verified`；否则显示 `unverified` 或 `approximate`。

当浏览器加载到已审核策略包时，6-max 机器人会按节点的混合频率执行 `fold/check/call/bet/raise/jam` 和下注尺度；如果节点未覆盖或策略包未审核，机器人会保留近似模型，并在牌局结束时显示 `已验证/未验证/近似` 计数，不会伪装成 GTO。

随机 6-max 模式已经接入多路核心训练桌；核心层现在提供精确 ICM 计算和赛事快照，ICM 固定场景也会在网页复盘中显示行动前后价值。经典固定场景仍保留旧场景适配器，后续再迁移到统一多路状态机，并接入真实的范围对范围权益与 solver 数据。
