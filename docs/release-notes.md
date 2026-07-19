# リリースノート

## 2026-07-19 post-release preview hardening

| 区分 | 内容 |
| --- | --- |
| 稼働確認 | `http://192.168.0.185:3100/` のダッシュボード表示、主要read-only API、管理系negative応答を確認。`release-smoke --read-only` は63 checks OK |
| Security | `CODIP_DISABLE_TOKEN_AUTH` を追加し、Cloudflare Access等のproxy auth配下で直接token経路を閉じられるようにした |
| Workers互換 | `assertSafeUrl()` のDNS事前検証を `resolve4` / `resolve6` へ変更。接続時DNSピン留めを保証できないCloudflare Workers runtimeでは外部URL取得を `unsupported_runtime` で安全停止 |
| Data | `standardRecordsAvailable()` を60秒TTL + single-flight化し、運用ロールバックと並行アクセス時の不整合を抑制 |
| Audit | データソース更新・削除は主操作と `audit_logs` 記録を同一transaction化し、証跡欠落時に主操作だけが成功する経路を縮小 |
| Docs | README、運用設計、監視runbook、リリースノートを更新 |
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
| P2 | Issue #46 監査記録の原子性 | データソース更新・削除は同一transaction化済み。残りはデータソース登録、タグ操作、クライアント起点イベントの同一transaction/outbox方式適用 |
| P2 | De-dockerization #35 | CI/branch protection/docsを確認し、Docker依存ゲートを段階的に置換 |
