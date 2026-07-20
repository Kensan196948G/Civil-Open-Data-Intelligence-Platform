# 監視・アラート runbook

## 1. 監視対象

| 対象 | 確認方法 | 異常判定 |
| --- | --- | --- |
| アプリ生存 | `GET /api/health` | 連続2回以上 200 以外 |
| DB接続 | `GET /api/ready` | 503 または応答遅延 |
| API契約 | `GET /api/openapi` | 200 以外、OpenAPI version欠落 |
| 管理保護 | 未認証 `GET /api/fetch-logs` | 401 以外 |
| ブラウザ | ダッシュボード表示、console error/warn | 主要画面の描画失敗、console error |

## 1.1 アラート運用

実通知先は本番Cloudflare/Neon作成時に確定する。未確定の間は、本表を暫定SLO/エスカレーション基準として扱い、確認結果を `docs/16-release-readiness-checklist.md` と `docs/release-notes.md` に記録する。

| 重大度 | 条件 | 初動目標 | 初動担当 | エスカレーション | 復旧目標 |
| --- | --- | ---: | --- | --- | ---: |
| P1 | `/api/ready` 503継続、認証バイパス疑い、データ破損疑い、Cloudflare本番routing障害 | 15分 | ReleaseManager / DevOps | CTO判断でrollback runbookへ移行 | 60分 |
| P2 | 主要API 5xx増加、Workers error増加、Neon接続遅延、read-only smoke失敗 | 30分 | DevOps / QA | SecurityまたはDB影響時はCTOへ即時共有 | 4時間 |
| P3 | console warn、低頻度の外部API timeout、監査ログ欠落疑い、性能劣化傾向 | 1営業日 | QA / Developer | 週次改善Issueへ登録 | 次回改善サイクル |

| 通知経路 | 現状 | 本番化時の完了条件 |
| --- | --- | --- |
| Cloudflare Workers Logs / Traces | 手動確認予定 | error rate、例外sample、対象deploy idをEvidenceへ記録 |
| Cloudflare alert / Web Analytics | 未設定 | 通知先、閾値、通知テスト結果を記録 |
| Neon monitoring | 未設定 | branch、容量、接続数、slow query、PITR windowを記録 |
| GitHub Actions | 設定済み | CI失敗時の担当・Issue化ルールをProjectへ反映 |

実ターゲットの監視証跡は、Secrets値や個人情報を出さずに次の環境変数で `production-evidence` へ渡す。値はレポートに表示されず、`set (recorded)` のみ出力される。

| 変数 | 記録する証跡 |
| --- | --- |
| `CODIP_CLOUDFLARE_ACCESS_EVIDENCE` | Access application domain、policy名、allowlist summary、proxy secret設定済み証跡 |
| `CODIP_MONITORING_CONTACTS` | 通知経路またはon-callグループ名 |
| `CODIP_CLOUDFLARE_ALERT_POLICY` | Cloudflare alert policy名、閾値概要、通知テスト時刻 |
| `CODIP_CLOUDFLARE_LOGS_EVIDENCE` | Workers Logs / Traces の確認クエリ、error count、対象deploy id |
| `CODIP_NEON_MONITORING_EVIDENCE` | Neon branch、容量、接続数、slow query、PITR window確認 |
| `CODIP_SMOKE_MONITORING_SCHEDULE` | read-only smokeの実行頻度、直近成功時刻、失敗時担当 |
| `CODIP_ROLLBACK_OWNER` | rollback判断者または当番ロール |
| `CODIP_BACKUP_RESTORE_EVIDENCE` | Neon PITR window、restore rehearsalまたはrollback drill結果、復旧確認担当 |
| `CODIP_NEON_BACKUP_EVIDENCE_JSON` | `release:check-neon-backup-evidence` が読む非Secret JSON証跡。PITR window、pg_dump artifact名、restore drill日時を記録 |

```bash
npm run release:production-evidence -- --strict
```

`--strict` はAccess証跡、上記監視証跡、バックアップ・リストア証跡が未記録の場合も失敗する。Cloudflare Workers Observabilityは `wrangler.jsonc` の `observability.enabled=true` を維持し、Workers Logs / Traces / alert policy の実確認結果をEvidenceへ転記する。NeonはPITR履歴ウィンドウ、restore rehearsalまたはrollback drillの結果、復旧確認担当を `CODIP_BACKUP_RESTORE_EVIDENCE` として記録する。

### 1.2 Neon backup鮮度ゲート

`CODIP_BACKUP_RESTORE_EVIDENCE` は人間向けの証跡名だけを検査する。PITR window短縮や `pg_dump` 未実行を機械的に落とすため、production/stagingの定期バックアップジョブはSecretを含まないJSONを `CODIP_NEON_BACKUP_EVIDENCE_JSON` として渡し、次のゲートを実行する。

本番向けの定期ジョブは `.github/workflows/neon-backup.yml` で管理する。`CODIP_NEON_PGDUMP_DATABASE_URL` / `CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE` Secretと `CODIP_LAST_RESTORE_DRILL_AT` Variableまたはdispatch入力が未設定の場合、workflowはfail-closedで失敗し、バックアップ運用のドリフトをGitHub Actions上で可視化する。

```bash
npm run release:create-neon-backup-evidence -- \
  --project-id falling-dawn-93620497 \
  --branch production \
  --history-window-hours 24 \
  --pg-dump-artifact secure-artifact://codip/neon/20260720T063000Z.dump \
  --pg-dump-at 2026-07-20T06:30:00Z \
  --restore-drill-at 2026-07-19T06:30:00Z \
  --owner release-manager \
  --pretty
```

または、定期ジョブが生成した非Secret JSONを次のように渡す。

```bash
export CODIP_NEON_BACKUP_EVIDENCE_JSON='{
  "checkedAt": "2026-07-20T07:00:00Z",
  "projectId": "falling-dawn-93620497",
  "branch": "production",
  "historyWindowHours": 24,
  "lastPgDumpAt": "2026-07-20T06:30:00Z",
  "lastPgDumpStatus": "success",
  "lastPgDumpArtifact": "secure-artifact://codip/neon/20260720T063000Z.dump",
  "lastRestoreDrillAt": "2026-07-19T06:30:00Z",
  "restoreDrillStatus": "success",
  "owner": "release-manager"
}'
npm run release:check-neon-backup-evidence
```

既定では `historyWindowHours >= 24`、`lastPgDumpAt` が24時間以内、`lastRestoreDrillAt` が30日以内、各statusが `success` の場合だけ成功する。接続文字列、Neon API token、DB passwordはこのJSONへ入れない。誤って混入したSecret風文字列は出力時にredactされるが、証跡保存前に破棄して再発行する。`release:create-neon-backup-evidence` もSecret風のartifact識別子を拒否する。

## 2. ポストリリース状態確認

Cloudflare / Neon の実リソースを変更せず、DNS、HTTP到達性、応答時間、`/api/ready` のDB状態を読み取り専用で確認する。production DNSが未解決の場合、通常モードでは「本番未接続」として記録し、共有previewの健全性を確認できればコマンドは成功する。

```powershell
npm run release:post-release-status -- --preview-url http://192.168.0.185:3100 --production-url https://civilopendata.mirai-dx-platform.com --max-response-ms 5000
```

本番Custom Domain、DNS、Access、Secrets、Hyperdrive、Neon branchの作成・承認後は、production未接続を失敗扱いにする。

```powershell
npm run release:post-release-status -- --strict-production --production-url https://civilopendata.mirai-dx-platform.com --max-response-ms 5000
```

このコマンドはCloudflare API、Neon API、Secrets値を読み取らない。`/api/ready` が標準JSON (`status=ready`, `checks.database=ok`) を返す場合はDB接続確認として判定し、応答が `--max-response-ms` を超える場合はnot readyとして扱う。Access配下で `/api/health` / `/api/ready` が認証必須になる構成では、strict実行前に読み取り専用health endpointの公開範囲を運用設計で確定する。

`522` が返る場合、レポートの `Production Route Diagnosis` を確認する。Cloudflare edge header (`server: cloudflare` または `cf-ray`) がある `522` は、DNSがCloudflareへ届いている一方で、Worker routeがリクエストを処理せずorigin接続タイムアウトになっている可能性が高い。まず `npm run release:cloudflare-522-diagnostics` で Cloudflare へ接続しない証跡チェックリストを保存する。承認済みCloudflare認証情報を持つ担当者のみ `npm run release:cloudflare-522-diagnostics -- --execute-wrangler` を使い、DNSやSecretを変更する前に `deployments status/list`、`wrangler tail codip --env production --status error`、Cloudflare Dashboard の zone route / DNS record / Workers Logs を読み取り確認する。

## 3. 共有preview確認

```powershell
$base = "http://192.168.0.185:3100"
foreach ($path in @("/api/health", "/api/ready", "/api/dashboard", "/api/sources", "/api/openapi")) {
  Invoke-WebRequest -Uri "$base$path" -UseBasicParsing -TimeoutSec 15
}
```

管理系negative確認:

```powershell
Invoke-WebRequest -Uri "http://192.168.0.185:3100/api/fetch-logs" -UseBasicParsing -SkipHttpErrorCheck
Invoke-WebRequest -Uri "http://192.168.0.185:3100/api/admin/audit-events" -UseBasicParsing -SkipHttpErrorCheck
```

## 4. Cloudflare / Neon 本番化後

| 項目 | 確認 |
| --- | --- |
| Workers | `wrangler deployments list --env production`、Workers Logs / Traces |
| Access | 対象サブドメイン、policy、admin allowlist、service token/proxy secret |
| Hyperdrive | binding ID、Neon direct endpoint、TLS、connection pooling |
| Neon | branch、migration status、PostGIS extension、容量、PITR window |
| Backup / restore | Neon PITR履歴ウィンドウ、restore rehearsalまたはrollback drill、復旧確認担当 |
| Smoke | `npm run release:smoke -- --read-only --base-url https://<target>` |

## 5. 初動

| 事象 | 初動 |
| --- | --- |
| `/api/ready` 503 | DB接続文字列、migration、Neon branch、Hyperdrive statusを確認 |
| 管理APIが401でない | Access/proxy secret/`CODIP_DISABLE_TOKEN_AUTH`/admin token設定を確認 |
| 外部URL取得が全失敗 | Workers runtimeでは `unsupported_runtime` が想定される。Node previewで失敗する場合はDNSピン留め、SSRF guard、対象URL、外部ネットワークを確認 |
| レスポンス遅延 | DB slow query、外部APIタイムアウト、Cloudflare logsを確認 |

## 6. ロールバック判断

重大障害、データ破損、認証バイパス、高危険度脆弱性が疑われる場合は追加変更より復旧を優先し、`docs/runbooks/rollback.md` の判断フローへ移る。
