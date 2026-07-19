# 監視・アラート runbook

## 1. 監視対象

| 対象 | 確認方法 | 異常判定 |
| --- | --- | --- |
| アプリ生存 | `GET /api/health` | 連続2回以上 200 以外 |
| DB接続 | `GET /api/ready` | 503 または応答遅延 |
| API契約 | `GET /api/openapi` | 200 以外、OpenAPI version欠落 |
| 管理保護 | 未認証 `GET /api/fetch-logs` | 401 以外 |
| ブラウザ | ダッシュボード表示、console error/warn | 主要画面の描画失敗、console error |

## 2. 共有preview確認

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

## 3. Cloudflare / Neon 本番化後

| 項目 | 確認 |
| --- | --- |
| Workers | `wrangler deployments list --env production`、Workers Logs / Traces |
| Access | 対象サブドメイン、policy、admin allowlist、service token/proxy secret |
| Hyperdrive | binding ID、Neon direct endpoint、TLS、connection pooling |
| Neon | branch、migration status、PostGIS extension、容量、PITR window |
| Smoke | `npm run release:smoke -- --read-only --base-url https://<target>` |

## 4. 初動

| 事象 | 初動 |
| --- | --- |
| `/api/ready` 503 | DB接続文字列、migration、Neon branch、Hyperdrive statusを確認 |
| 管理APIが401でない | Access/proxy secret/`CODIP_DISABLE_TOKEN_AUTH`/admin token設定を確認 |
| 外部URL取得が全失敗 | Workers runtimeでは `unsupported_runtime` が想定される。Node previewで失敗する場合はDNSピン留め、SSRF guard、対象URL、外部ネットワークを確認 |
| レスポンス遅延 | DB slow query、外部APIタイムアウト、Cloudflare logsを確認 |

## 5. ロールバック判断

重大障害、データ破損、認証バイパス、高危険度脆弱性が疑われる場合は追加変更より復旧を優先し、`docs/runbooks/rollback.md` の判断フローへ移る。
