# リリース基準 (Release Criteria)

状態: 2026-09-09 制定
原則: 「利用者が結果を信用できる状態」を Release 条件とする。全項目が緑でなくても、
未達項目が既知制約として docs/16-release-readiness-checklist.md に記録され、
影響と回避策が説明できれば Release 判定は可能とする (条件付きリリースの原則)。

## 1. 自動判定 (必須)

| # | 基準 | 根拠コマンド / 場所 |
| --- | --- | --- |
| A1 | Build / Lint / Typecheck / Unit 全緑 | npm run build, lint, typecheck, test |
| A2 | Golden Dataset 全緑 (datasetVersion 固定) | tests/golden/ |
| A3 | Metamorphic 不変条件全緑 | tests/domain/ |
| A4 | Seed データ品質ポリシー全緑 | tests/data-quality/ |
| A5 | Fail-Safe 不変条件全緑 (依存障害時に誤値を返さない) | tests/resilience/ |
| A6 | v1 / docs / OpenAPI / Docker / 監査 / Cloudflare / Actions 契約 | npm run release:check-* |
| A7 | 依存監査 (production: blocking, 全体: allowlist) と gitleaks | ci.yml |
| A8 | migration 適用 + seed 冪等性 + 重複/ポリシーチェック | ci.yml postgresql-compat job |

## 2. 環境別確認 (ターゲットリリース時)

| # | 基準 | 根拠 |
| --- | --- | --- |
| B1 | 実ターゲット環境変数契約と証跡 | release:validate-env:production-target, production-evidence --strict |
| B2 | PostGIS DDL / migration drift なし | db:pg:check-postgis-ddl, db:pg:check-drift |
| B3 | read-only smoke (staging/production) 緑 | release:smoke --read-only |
| B4 | Docker 産物と SBOM/provenance | docker-supply-chain job |
| B5 | バックアップ復旧可能性の証跡が有効期限内 | release:check-neon-backup-evidence |

## 3. 障害時挙動 (Fail-Safe 基準)

| # | 基準 | 根拠 |
| --- | --- | --- |
| C1 | 提供元・DB 障害時に誤った値を正常結果として返さない | R-RES-* 全緑 + elevation/decision の 404/500 挙動 |
| C2 | 判定不能は「判定不能」と明示し、根拠 (attempted sources 等) を返す | v1 terrain elevation API 応答 |
| C3 | 監査ログはトランザクションで保証され、失敗時に判定も記録されない | tests/integration/audit-transaction.integration.test.ts |

## 4. 数値の正しさ (Logic / Data 基準)

| # | 基準 | 根拠 |
| --- | --- | --- |
| D1 | 品質スコアは配点表どおり (docs/08 §3) で Golden と一致 | G-QUAL |
| D2 | 判定 status は fail-closed: 根拠無しに go を返さない | G-DEC, M-DEC-* |
| D3 | 数値計算は TOLERANCE_SPEC.md の許容差内 | M-RP-*, M-SLOPE-* |
| D4 | 台帳 seed は重複・範囲・列挙・鮮度ポリシーを満たす | DQ-SEED* |

## 5. Human Acceptance (リリース担当者確認)

自動テストで代替できない以下を、Release Candidate の時点で担当者が確認する。
結果は docs/quality/TEST_EVIDENCE.md 様式で記録する。

| # | 確認事項 | 確認者の観点 |
| --- | --- | --- |
| H1 | 業務上利用可能 | 実務の判定フローが画面上で完結する (台帳→地図→判定→記録) |
| H2 | 結果が妥当 | 代表的な現場事例で判定・スコアが専門知識と矛盾しない |
| H3 | 誤解を招かない | 「0件」と「取得失敗」、品質スコアと安全性を混同しない表示 |
| H4 | 根拠を追跡可能 | 判定理由・出典・ライセンス・鮮度が画面から辿れる |
| H5 | 異常時に安全 | 通信断・提供元障害時に誤った値で判断させられない (C1-C3 の画面確認) |

H1-H5 の記録は docs/16-release-readiness-checklist.md の実ターゲット記録欄にもリンクする。
