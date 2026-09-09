# 数値判定の許容差仕様 (Tolerance Spec)

状態: 2026-09-09 制定

本仕様は数値を返すドメインロジックの期待値判定に用いる許容差を定める。
テスト側で許容差を場当たり的に決めないための正本であり、
許容差を変更する場合は本書を先に改定してからテストを更新する。

## 1. 基本原則

| 原則 | 内容 |
| --- | --- |
| 決定論 | 同一入力に対し同一出力を保証する処理（品質スコア・判定エンジン）は許容差なし (exact) で判定する |
| 浮動小数 | 浮動小数演算を含む処理（勾配・再現期間）は相対許容差または絶対許容差を明示して判定する |
| 精度起源 | 許容差の根拠は「入力データの測定精度」または「仕様上の丸め規格」のいずれかを明記する |

## 2. ドメイン別許容差

### 2.1 施工可否判定 (src/lib/decision/engine.ts)

| 項目 | 判定 | 許容差 | 根拠 |
| --- | --- | --- | --- |
| status (go/caution/stop) | exact | なし | 判定カテゴリ自体が仕様 |
| evaluatedCount | exact | なし | 整数計数 |
| reason 文面 | contains | 仕様文の部分一致 | 文面の微修正で Golden を壊さないため。ただし fail-closed 宣言文は必須 |

### 2.2 品質スコア (src/lib/quality.ts)

| 項目 | 判定 | 許容差 | 根拠 |
| --- | --- | --- | --- |
| 各サブスコア | exact | なし | 配点表 (docs/08-data-quality-policy.md §3) が仕様 |
| 総合スコア (0-100) | exact | なし | 整数丸め規定 (clamp + round) 済み |

### 2.3 地形・勾配 (src/lib/terrain/)

| 項目 | 判定 | 許容差 | 根拠 |
| --- | --- | --- | --- |
| calculateSlopeDeg | relative | 1e-9 | 同一 DEM 入力の決定論的三角法演算。誤差は浮動小数丸めのみ |
| 標高 (elevationM) | exact | なし | 国土地理院 DEM は整数メートル。小数値は入力不正とみなす |

### 2.4 再現期間 (src/lib/analysis/return-period.ts)

| 項目 | 判定 | 許容差 | 根拠 |
| --- | --- | --- | --- |
| Gumbel/Weibull 量子位 | relative | 1e-6 | 線形回帰・対数演算を含む浮動小数計算。実務閾値判定 (15mm 等) に対し十分小さい |
| 分布メソッド切替時 | 仕様 | 比較不可 | Gumbel と Weibull の値は互いに許容差で比較しない (別仕様) |

### 2.5 データ品質 (tests/data-quality/)

| 項目 | 判定 | 許容差 | 根拠 |
| --- | --- | --- | --- |
| 緯度経度 | range | lat -90〜90 / lon -180〜180 | docs/09-security-and-compliance.md と v1 invalid_query 契約に一致 |
| 品質スコア (seed) | range | 0〜100 | quality.ts の配点上限 |
| lastCheckedAt | invariant | 未来日不可 | 鮮度スコアの前提 |
