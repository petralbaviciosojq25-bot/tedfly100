# 可审计策略包格式

策略包格式为 `poker-trainer-strategy-pack/v1`，只接受具有明确游戏规则、来源、求解器名称、版本、下注树和节点频率的 JSON 文件。

节点的 `match` 还可以声明 `activePlayers`、`potType`（`heads-up` 或 `multiway`）和 `icmMode`，用于区分真实多人行动线与赛事压力节点。命中精确公共牌/行动线时置信度为 1；只有约束条件命中时为 0.85；未审核或未覆盖节点不会进入机器人频率采样。

## 可信度规则

- `unverified`：可以保存和查看，但绝不影响“solver 基准”评分。
- `integrity-verified`：服务器已验证 `integrity.payloadSha256` 与包内容一致；这只证明文件未被修改。
- `solver-verified`：除哈希一致外，实际载荷哈希还必须命中服务端的 `trusted_solver_audits.json` 可信审核登记表。策略包内的 `audit.status` 仅是来源方声明，不能自行获得 Solver 资格。只有命中登记表的完整节点才会作为可审计 Solver 基准。

没有命中上述条件时，训练器统一显示“近似策略 / 未覆盖节点”。

## 最小示例

```json
{
  "format": "poker-trainer-strategy-pack/v1",
  "name": "Example 6-max NLHE",
  "version": "2026.08.0",
  "source": {"url": "https://example.org/export.json", "solver": "Solver name", "exportedAt": "2026-08-13T00:00:00Z"},
  "solution": {"game": "NLHE", "players": 6, "stackBB": 100, "bettingTree": "2.5x open, 3bet 9bb"},
  "integrity": {"algorithm": "sha256", "payloadSha256": "64 位小写十六进制 SHA-256"},
  "audit": {"status": "unverified"},
  "nodes": [{
    "id": "btn-vs-bb-river-01",
    "match": {"players": 6, "stackBB": 100, "street": "river", "heroPosition": "BB", "villainPosition": "BTN", "facingBet": true},
    "strategy": {"frequencies": {"fold": 0.22, "call": 0.68, "raise125": 0.10}, "evBB": {"fold": 0, "call": 1.1, "raise125": 0.7}}
  }]
}
```

计算哈希时排除 `integrity`、`verification`、`id`、`kind`、`quality` 与 `updatedAt` 字段，并以键名字典序递归序列化其余内容。服务端会返回实际哈希与声明哈希的比较结果。

## 可信审核登记

默认登记表为空，因此项目不会把示例数据或自声明数据当成 GTO。完成独立复核后，维护者可在 `trusted_solver_audits.json` 的 `entries` 中登记载荷哈希，并同时限定来源、求解器、包名和版本：

```json
{
  "payloadSha256": "64 位小写十六进制 SHA-256",
  "sourceUrl": "https://example.org/export.json",
  "solver": "Solver name",
  "packName": "Example 6-max NLHE",
  "packVersion": "2026.08.0",
  "reviewer": "审核人或审核流程标识"
}
```

登记表表示本地服务维护者的信任决策，不等同于第三方数字签名。后续如需跨设备分发可信包，应再增加公钥签名验证。
