# リリースノート

## 2026-07-19 post-release preview hardening

| 区分 | 内容 |
| --- | --- |
| 稼働確認 | `http://192.168.0.185:3100/` のダッシュボード表示、主要read-only API、管理系negative応答を確認。`release-smoke --read-only` は63 checks OK |
| Security | `CODIP_DISABLE_TOKEN_AUTH` を追加し、Cloudflare Access等のproxy auth配下で直接token経路を閉じられるようにした |
| Workers互換 | `assertSafeUrl()` のDNS事前検証を `resolve4` / `resolve6` へ変更。接続時DNSピン留めを保証できないCloudflare Workers runtimeでは外部URL取得を `unsupported_runtime` で安全停止 |
| Data | `standardRecordsAvailable()` を60秒TTL + single-flight化し、運用ロールバックと並行アクセス時の不整合を抑制 |
| Audit | データソース登録・更新・削除、タグ追加・削除、接続確認、サンプル取得、品質再計算は主操作と `audit_logs` 記録を同一transaction化。クライアント起点監査イベントは記録失敗時に503を返す |
| Production evidence | `npm run release:production-evidence -- --strict` を追加。Cloudflare/Neon実ターゲット、監視・アラート、バックアップ・リストアのEvidence入力をSecret値なしMarkdownで出力し、未充足時は失敗する |
| Cloudflare deploy gate | `npm run release:check-production-placeholders -- --env production` を追加。production Hyperdrive ID等の未解決placeholderが残る状態で本番検証を進めない |
| Cloudflare artifact gate | `npm run release:check-cloudflare-build-artifact` を追加。`cf:build` 後にOpenNextのWorker entrypointと静的assetsが存在することをdeploy前に確認する |
| Windows scripts | `DATABASE_URL=...` 形式のnpm scriptsをWindows互換ラッパーへ変更。`npm run build` がWindows/UNC環境でも実行可能になった |
| Docs | README、運用設計、監視runbook、Cloudflare/Neon runbook、リリースノートを更新 |
| CI/契約 | Windows/UNCでOpenAPI route coverageが全APIをmissing扱いするパス正規化不具合を修正 |
| Cloudflare | production FQDNを `civilopendata.mirai-dx-platform.com` に固定し、Workers Custom Domain、Access Terraform例、Cloudflare/Neon Runbook、契約チェックへ反映 |
| CI証跡 | PR #49 のCloudflare target反映commit `040c7bc` に対して CI #82 / CodeQL #64 が success。verify、e2e、postgresql-compat、docker-preview、docker-image-security が全てsuccess |

### 確認URL

| URL | 結果 |
| --- | --- |
| `/` | 200。ダッシュボード表示成功 |
| `/api/health` | 200 |
| `/api/ready` | 200 |
| `/api/dashboard` | 200 |
| `/api/sources` | 200 |
| `/api/openapi` | 200 |
| `/api/fetch-logs` | 401。未認証で保護 |
| `/api/admin/audit-events` | 405。GET不可 |
| `https://civilopendata.mirai-dx-platform.com` | 未実行。Cloudflare Custom Domain / DNS / Access / Hyperdrive / Secrets / Neon実リソース作成は人間承認待ち |

### 残課題

| 優先度 | 項目 | 方針 |
| --- | --- | --- |
| P1 | Issue #18 の残り: 実Hyperdrive/Neon証跡、外部URL取得の専用egress設計 | Prisma Hyperdrive driver adapter側は `@prisma/adapter-pg` で実装済み。Cloudflare Workersでは接続時DNSピン留め不可のため外部URL取得を安全停止 |
| P1 | Cloudflare/Neon実リソース未確定 | 人間承認後に Worker、Hyperdrive、Access、Secrets、Neon branch を作成し証跡化 |
| P2 | Issue #46 監査記録の原子性 | 主要な台帳・タグ・接続確認・サンプル取得・品質再計算は同一transaction化済み。クライアント起点イベントは記録失敗を503化済み。残りは将来の長時間外部処理増加時にoutbox方式を採用するかの設計判断 |
| P2 | 本番Evidence自動取得 | `production-evidence` はSecret非表示の入力状態と手動貼付欄まで。Cloudflare/Neon APIからの実ログ自動収集は認証・権限確認後に追加 |
| P2 | De-dockerization #35 | CI/branch protection/docsを確認し、Docker依存ゲートを段階的に置換 |
