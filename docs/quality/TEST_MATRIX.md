# テストマトリクス (Test Matrix)

状態: 2026-09-09 制定
目的: Requirement と Test ID の対応を維持し、変更時に抜けを検知する。
Test ID 接頭辞: G- (golden) / M- (metamorphic, domain) / DQ- (data-quality) / R- (resilience) / U- (既存 unit) / E- (既存 e2e) / S- (既存 script gate)

## 1. Gate 2 Logic & Data Quality (2026-09-09 追加分)

| Test ID | Requirement | 検証内容 | 実装 |
| --- | --- | --- | --- |
| G-DEC | REQ 施工可否判定 | 既知入力→status/理由 (fail-closed 含む) を Golden Dataset で固定 | tests/golden/decision-engine.golden.test.ts |
| G-QUAL | REQ 品質スコア | 配点表どおりの既知入力→サブスコア/総合点 | tests/golden/quality-score.golden.test.ts |
| M-DEC-1 | 不変条件 | ルール順序を入れ替えて status・matched 数不変 | tests/domain/metamorphic-decision.test.ts |
| M-DEC-2 | 単調性 | stop 違反の追加で status が緩和されない | (同上) |
| M-DEC-3 | 単調性 | 欠測は go を caution 以上にするが stop を緩めない | (同上) |
| M-RP-1 | 再現期間 | 全年度最大値を c 倍すると量子位も c 倍 (スケール不変) | tests/domain/metamorphic-return-period.test.ts |
| M-RP-2 | 再現期間 | 全値に t 加算すると Gumbel 量子位も t 加算 (平行移動不変) | (同上) |
| M-RP-3 | 再現期間 | T2>T1 で量子位は単調非減少 | (同上) |
| M-SLOPE-1 | 地形勾配 | 全セル標高に定数加算しても勾配不変 (オフセット不変) | tests/domain/metamorphic-terrain-slope.test.ts |
| M-SLOPE-2 | 地形勾配 | 東向きと北向きの同一傾斜は同一角度 | (同上) |
| DQ-SEED | 台帳 Seed | 公式URL/名前の重複なし、URL 形式、カテゴリ・形式・アクセス種は列挙値のみ | tests/data-quality/seed-data-policy.test.ts |
| DQ-SEED-2 | 台帳 Seed | trustLevel 1-5、qualityScore 0-100、タグは INITIAL_TAGS 内、出典 PROVIDERS 内 | (同上) |

## 2. Gate 4 Resilience / Fail-Safe (2026-09-09 追加分)

| Test ID | Requirement | 検証内容 | 実装 |
| --- | --- | --- | --- |
| R-RES-1 | 判定 API | DB 障害時に 2xx + 判定値を返さない (誤った go を返さない) | tests/resilience/fail-safe-dependency-failure.test.ts |
| R-RES-2 | 判定エンジン | 欠測・不正演算子は unevaluated に記録され go にならない | (同上、Golden と二重化) |
| R-RES-3 | 標高 | 提供元障害時は upstream_unavailable で判定不能を明示 (elevation 0 を返さない) | (同上) |
| R-RES-4 | 収集 | WAF が HTML を返す 200 を success と記録しない (無言の失敗防止) | (同上) |

## 3. 既存資産との対応 (Gate 1/3/4 主要項目の現在地)

| Gate | 領域 | 既存 Test ID (代表) | 場所 |
| --- | --- | --- | --- |
| 1 | 判定エンジン単体 | U- (fail-closed, stop, out-of-effect) | tests/unit/decision-engine.test.ts |
| 1 | 品質スコア単体 | U- (配点, 境界) | tests/unit/quality.test.ts |
| 1 | URL 安全化 | U- (url-guard, url-safety, official-url, terrain-url-safety) | tests/unit/ |
| 1 | 認証・認可 | U- (admin-auth, rbac, authorization-denial-paths, proxy-auth-inject) | tests/unit/ |
| 1 | レート制限・CSRF | U- (rate-limit, admin-session-route, csp-contract) | tests/unit/ |
| 1 | 収集 | U- (ingestion-engine, ingestion-silent-failure, ingestion-xml, harvest-ckan) | tests/unit/ |
| 1 | 地形 | U- (terrain-*, gsi, elevation-route, section-line, geometry-bounds-validation) | tests/unit/ |
| 1 | 契約 | S- (v1-contract, doc-api, openapi-coverage, docker, audit, cloudflare, actions) | scripts/tools/ + ci.yml |
| 1 | 依存 | S- (dependency-audit-gate, codeql-sarif-gate) + gitleaks | ci.yml |
| 3 | E2E Workflow | E- (dashboard, sources-search, register-source, tags, logs, map, weather-thresholds, watchlist) | tests/e2e/ |
| 3 | A11y / Responsive / PWA / CSP | E- (accessibility, interactive-element-a11y, responsive, pwa, csp) | tests/e2e/ |
| 3 | 負荷 | S- load-test workflow | .github/workflows/load-test.yml |
| 4 | 監査 | U- + integration (audit-transaction-routes, evidence-gate-*, RUN_DB_INTEGRATION 実 DB) | tests/unit, tests/integration |
| 4 | Backup / Restore | S- (neon-backup-evidence create/check, systemd/backup 鮮度検知) | scripts/tools/ |
| 4 | 証跡 | S- (production-evidence-report, validate-env, production placeholders) | scripts/tools/ |

## 4. 未整備 (意図的に見送っている領域)

| 領域 | 現状 | 解消条件 |
| --- | --- | --- |
| Cross Browser | Chromium のみ (本環境は Playwright Chromium 起動制約あり) | ブラウザ実行環境での再検証 (docs/12-test-plan.md §4 の既知制約) |
| Nightly E2E/Load | load-test.yml, production-smoke.yml は手動/イベント起動 | スケジュール化が必要になった時点で cron 追加 |
| AI Eval | LLM 未使用のため N/A | TEST_STRATEGY §5 の発生条件 |
| Fuzz | 不正入力系は単体テストで代表値を検証 | 外部入力経路の複雑化時に導入 |
