# テスト証跡記録様式 (Test Evidence)

状態: 2026-09-09 制定
目的: 「PASS 何件」ではなく「なぜ Release 可能なのか」を後から説明できる状態にする。

## 1. 記録様式

| 項目 | 内容 | 例 |
| --- | --- | --- |
| Requirement ID | 要件定義書の節または機能名 | REQ-D04 施工可否判定 |
| Test ID | テスト識別子 | G-DEC-001 (Golden) / M-DEC-001 (Metamorphic) / R-RES-001 (Resilience) |
| Version | 検証対象コミット | 05e2eec |
| Input | 入力 (Golden Dataset version を含む) | testdata/golden/decision-engine-golden.json v1.0.0 |
| Expected | 期待値 | status=caution (fail-closed) |
| Actual | 実測値 | caution |
| Tolerance | 許容差 (TOLERANCE_SPEC 参照) | exact |
| Test Data Version | Golden Dataset の datasetVersion | 1.0.0 |
| Environment | 実行環境 | CI ubuntu-24.04 / local Node 22 |
| Timestamp | 実行日時 | 2026-09-09T17:50:00+09:00 |
| Result | PASS / FAIL | PASS |
| Log / Evidence | 証跡リンク | CI run URL / vitest 出力 |

## 2. 記録方針

1. Gate 2 (Golden / Metamorphic) と Gate 4 (Resilience) の追加は本様式で記録する。
2. 日常の unit/E2E は CI ログ自体を証跡とし、個別記録は省略してよい。
3. Golden Dataset の expected を変更する場合は、変更理由と根拠 (仕様条項) をこの文書の履歴節に追記する。
4. Product 側不具合を発見した場合、修正コミットと Regression Test ID をここに記録する。

## 3. Golden Dataset 変更履歴

| 日付 | Dataset | Version | 変更内容 | 理由 (仕様条項) |
| --- | --- | --- | --- | --- |
| 2026-09-09 | decision-engine-golden | 1.0.0 | 初版作成 | fail-closed 仕様の固定 (engine.ts docstring) |
| 2026-09-09 | quality-score-golden | 1.0.0 | 初版作成 | 配点表 (docs/08-data-quality-policy.md §3) |

## 4. 不具合発見・修正記録

| 日付 | Test ID | 内容 | 対応 |
| --- | --- | --- | --- |
| 2026-09-09 | M-RP-1 / M-RP-3 | Weibull 再現期間が T に対して非単調かつ桁外れ (年最大値 [48..102] で T=2→164, T=100→1.4e-7)。公開 API `GET /api/v1/analysis/wave50?method=weibull` が誤った値を返していた。旧実装の二重の誤り: (1) 回帰軸の入れ替わり (log x を log u に回帰すべき所を log x 側の分散で除算) (2) 量子位式の誤り (-ln(1-1/T) 使用、正しくは ln T)。wmcdss 原典は Gumbel のみで、Weibull は TS 追加分だった | `src/lib/analysis/return-period.ts` の weibullFit / weibullQuantile を正規の Gringorten 回帰 + x_T = λ(ln T)^(1/k) に修正。Regression: tests/unit/return-period.test.ts (単調性・妥当性), tests/domain/metamorphic-return-period.test.ts (スケール不変・T 単調) |
| 2026-09-09 | DQ-SEED (タグ整合性) | シードソース 3 件が INITIAL_TAGS 未登録のタグ (地図 / 海象 / 研究) を参照しており、seed.ts が `if (!tagId) continue` で**無言でタグ付けを破棄**していた (地理院地図・気象庁 波浪予想図・国土技術政策総合研究所 研究成果) | `prisma/seed-data.ts` の INITIAL_TAGS に欠落タグ 3 件を追加 (シード作者のタグ付け意図を尊重)。回帰防止: tests/data-quality/seed-data-policy.test.ts が PR でタグ参照整合性を検証する |
