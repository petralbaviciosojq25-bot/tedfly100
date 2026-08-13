# 可审计策略包格式

策略包格式为 `poker-trainer-strategy-pack/v1`，只接受具有明确游戏规则、来源、求解器名称、版本、下注树和节点频率的 JSON 文件。

## 可信度规则

- `unverified`：可以保存和查看，但绝不影响“solver 基准”评分。
- `integrity-verified`：服务器已验证 `integrity.payloadSha256` 与包内容一致；这只证明文件未被修改。
- `solver-verified`：除哈希一致外，包还必须包含人工审核的 `audit.status: "solver-verified"`。只有这类包的完整命中节点才会作为可审计 solver 基准。

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
