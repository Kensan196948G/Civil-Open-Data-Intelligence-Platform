# 🚨 インシデント対応 Runbook

CODIP本番（`odip.mirai-dx-platform.com` / Worker `codip-production` / Neon `falling-dawn-93620497`）で異常を検知した場合の対応フロー。詳細手順は `docs/runbooks/monitoring.md`・`docs/runbooks/rollback.md` を正本とする。

## 1. 重大度定義

| 重大度 | 条件 | 初動目標 | 初動担当 | 復旧目標 |
| --- | --- | ---: | --- | ---: |
| P1 | `/api/ready` 503継続、認証バイパス疑い、データ破損疑い、Cloudflare本番routing障害 | 15分 | ReleaseManager / DevOps | 60分 |
| P2 | 主要API 5xx増加、Workers error増加、Neon接続遅延、read-only smoke失敗 | 30分 | DevOps / QA | 4時間 |
| P3 | console warn、低頻度外部API timeout、監査ログ欠落疑い、性能劣化傾向 | 1営業日 | QA / Developer | 次回改善サイクル |

## 2. 検知経路

| 経路 | 周期 | 通知の実体 | 到達範囲 |
| --- | --- | --- | --- |
| `production-smoke.yml` | 15分 | **incident Issue を自動起票**（連続2回以上で P1 へ昇格） | `odip` のみ |
| `neon-backup.yml` | 日次 | **失敗時に `backup-incident` Issue を自動起票**（連続失敗数を run 履歴から算出） | — |
| `sla-monitor.yml` | 日次 | `data-watch-digest` Issue を作成・更新 | データ鮮度 |
| Workers Logs / Traces、Neon Console | 随時 | 手動確認 | 全 env |
| 利用者からの報告 | — | — | 全 env |

⚠️ **`codip-mvp`（公開レビュー環境）は自動監視の対象外**である。
`production-smoke.yml:51` の probe 対象は `odip` のみで、`codip-mvp` が停止しても検知されない。
公開中に停止すると外部レビュアーに影響するため、手動確認の手順を §3 に含める。

⚠️ **`--preview-url` は実質的に死んでいる。** `production-smoke.yml:52` は
`http://192.168.0.185:3100`（LAN 内 IP）を指しており、GitHub hosted runner からは到達できない。
`--allow-preview-down` が付いているため常に無視され、preview 側は何も測っていない。
「preview が緑」に見えても、それは**測った結果ではなく測っていない結果**である。

手動での状態確認:

```bash
# 本番（Access 保護下。302 は Access 境界であり正常）
npm run release:post-release-status -- \
  --production-url https://odip.mirai-dx-platform.com \
  --strict-production --max-response-ms 5000

# 公開MVP（Access 無し。200 と checks.database=ok を期待）
curl -sS -w '\nHTTP %{http_code} %{time_total}s\n' \
  https://codip-mvp.mirai-dx-platform.com/api/ready
```

## 3. 初動フロー

各手順はそのまま実行できる形で書く。**リポジトリ直下**で実行すること。

### 3.1 事象確認（目標 2 分）

```bash
npm run release:post-release-status -- \
  --production-url https://odip.mirai-dx-platform.com \
  --strict-production --max-response-ms 5000
```

| 観測 | 意味 | 次の手順 |
| --- | --- | --- |
| `302` | Cloudflare Access の境界。**正常** | 認証つき probe（§3.2）へ |
| `200` + `checks.database=ok` | 正常 | 誤検知を疑い §3.3 の切り分けへ |
| `503` | アプリは応答、DB 到達不可 | §3.3 の DB |
| `522` | Worker route / origin 到達不可 | §3.4 |
| 応答なし / DNS 解決不可 | routing または DNS | §3.4 |

### 3.2 Access 越しの認証つき probe

service token は Secrets にあり、値をターミナルへ展開しない。

```bash
# GitHub Actions 側で実行する（ローカルに token を降ろさない）
gh workflow run production-smoke.yml
sleep 5

# ⚠️ このワークフローは15分毎の scheduled run も走る。--limit 1 だけでは
#    別の scheduled run を掴む。--event=workflow_dispatch で自分の run に固定する。
RUN_ID=$(gh run list --workflow=production-smoke.yml \
  --event=workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId')
echo "watching run: $RUN_ID"
gh run watch "$RUN_ID" --exit-status
```

**本番の判定はこの run の成否だけを根拠にする。** `post-release-status.js` は
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` が設定されているときにだけ
Access ヘッダーを付ける（`scripts/tools/post-release-status.js:24-25`）。
認証情報を持たないローカル実行では **Access の外側しか見えず、本番復旧の確認にならない**。

### 3.3 切り分け（Worker → DB → Access の順）

```bash
# --- Worker: 現在の deployment と直近の変更 ---
npx wrangler deployments list --env production

# --- Worker: エラーのみを追う（Ctrl-C で終了）---
npx wrangler tail --env production --status error --format pretty

```

🚫 **本番 DB の状態を `codip-mvp` で代用してはならない。**
`codip-mvp` は Neon branch `mvp-20260813` を使う独立環境であり
（`scripts/deploy/deploy-mvp.mjs:5,39`。production の `main` branch には触れない）、
その `/api/ready` が `ok` でも**本番 DB については何も言っていない**。
障害中にこれを見ると「DB は正常」という誤った切り分けになる。

本番 DB の機械的判定は `/api/ready` の `checks.database` だが、本番は Access 配下に
あるため §3.2 の認証つき probe（GitHub Actions 側）で取得する。
詳細（branch / 容量 / 接続数 / slow query）は Neon Console で確認する。
`sla-monitor` の鮮度閾値は §7 の SLO 表を参照。

公開MVPの手動確認（**本番の切り分けではない**。MVP 自体の障害時のみ）:

```bash
curl -sS https://codip-mvp.mirai-dx-platform.com/api/ready | jq '.checks, .responseTimeMs'
```

### 3.4 Cloudflare 522 / routing の診断

```bash
npm run release:cloudflare-522-diagnostics
```

### 3.5 連絡

- **P1**: 直ちに human（kensan）へ連絡する。`production-smoke.yml` は連続2回以上の失敗で
  incident Issue を **P1** へ昇格させるため、Issue の重大度ラベルと突き合わせる。
- **P2 / P3**: 自動起票された Issue へ調査結果を追記する。
- 外部通知先（メール / Webhook）は**未設定**である。追加は人間承認事項であり、
  現状の到達範囲は GitHub Issue と Actions の既定通知に限られる。

### 3.6 復旧判断と実行

`docs/runbooks/rollback.md` §1 の判断フローで「コードのみ / DBのみ / 両方」を決める。

```bash
# --- コードのみ: 直前の deployment へ戻す ---
npx wrangler deployments list --env production          # 戻し先の version-id を確認
npx wrangler rollback <version-id> --env production
npm run release:post-release-status -- \
  --production-url https://odip.mirai-dx-platform.com --strict-production
```

DB の復旧（Neon PITR restore）は**上書きであり取り消しが困難**ため、
`rollback.md` §4 に従い human 承認を得てから実行する。復旧前に必ず現状 branch を保存する。

> 🚫 **Docker / GHCR は本番の復旧経路ではない。** 本番は Cloudflare Workers であり、
> Docker イメージはデプロイに使用していない（Issue #35 で CI からの段階的撤去を追跡）。
> 障害時に GHCR digest を差し戻しても本番は変わらない。

### 3.7 検証

```bash
# 本番の復旧確認は §3.2 と同じ「認証つき probe を dispatch して、その run の成否を見る」
gh workflow run production-smoke.yml
sleep 5
RUN_ID=$(gh run list --workflow=production-smoke.yml \
  --event=workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status

# 以降の scheduled run が継続して成功していることも確認する
gh run list --workflow=production-smoke.yml --limit 5
```

`/api/ready=200`（Access 経由）、主要画面 / API、管理系の negative ケース、
直近 smoke の継続成功を確認する。

公開MVPを戻した場合は、それとは別に直接確認する。

```bash
curl -sS -w '\nHTTP %{http_code}\n' https://codip-mvp.mirai-dx-platform.com/api/ready
```

### 3.8 記録

`docs/operations/operations-ledger.md` の実行記録へ追記し、incident Issue へ証跡を残す。

## 4. メンテナンス方針

- 本番メンテナンスは原則 **03:00〜05:00 JST（日次バックアップ後）** に実施する（要human確認）。
- 破壊的migration・データ訂正・Access変更は、バックアップ取得・rollback手順確認後にhuman承認で実施する。
- メンテナンス前後で `/api/ready` とproduction smokeを必ず確認する。

## 5. データ訂正ポリシー

- 原則 **forward-fix**（SQL/アプリ修正で正しく直す）とする。audit_logsとともにIssue・PRへ証跡を残す。
- 一括UPDATE/DELETEは事前に `pg_dump` またはPITR復元可能時点を確保し、dry-run→実行者・確認者を明記する。
- PITR restoreは最終手段（上書きであり取り消しが困難）。`rollback.md` §4に従い、復旧前に必ず現状branchを保存する。
- 個人情報・会社データに関わる訂正はhuman承認必須。

## 6. ポストモーテム

- P1/P2インシデントは、復旧後7日以内に「事象・影響・原因・対応・防止策」をIssueへ記録する。
- 再発防止策は `docs/operations/operations-ledger.md` の定期点検へ組み込み、四半期に振り返る。

## 7. SLI / SLO

**すべて既存の実装から導いた値であり、新たに目標を発明していない。**
出典を併記し、変更するときは実装側と同時に直す。

| SLI | 測定方法（実装） | 閾値・SLO | 出典 | 違反時 |
| --- | --- | --- | --- | --- |
| 本番可用性 | `post-release-status.js` が `/api/health` `/api/ready` を probe | 15分毎の probe が成功 | `production-smoke.yml`（cron `7,22,37,52 * * * *`） | incident Issue 自動起票 |
| 本番応答時間 | 同 probe の `responseTimeMs` | **≤ 5000ms** | `post-release-status.js:8` `DEFAULT_MAX_RESPONSE_MS` | probe を not ready 扱い |
| DB 到達性 | `/api/ready` の `checks.database` | `ok` | `src/app/api/ready/route.ts` | P1 相当 |
| 連続失敗 | run 履歴から算出 | **2回以上で P1 昇格** | `production-smoke.yml:109-136` | 重大度を引き上げ |
| データ鮮度（realtime） | `sla-monitor.js` が最終取得時刻を評価 | **≤ 6時間** | `scripts/ingestion/sla-monitor.js:20` | 日次ダイジェストへ計上 |
| データ鮮度（10min） | 同上 | **≤ 1時間** | 同 `:21` | 同上 |
| データ鮮度（hourly） | 同上 | **≤ 4時間** | 同 `:22` | 同上 |
| データ鮮度（daily） | 同上 | **≤ 30時間** | 同 `:23` | 同上 |
| バックアップ鮮度 | `check-neon-backup-evidence.js` | 24時間以内の成功 | `neon-backup.yml` | `backup-incident` Issue 自動起票 |

### 未定義（意図的に空欄のまま残す）

次は**まだ測っていない**。将来の作業を実施済みとして書かないため、空欄で残す。

| 項目 | 現状 | 定義に必要なこと |
| --- | --- | --- |
| エラー率（5xx 比率）の SLO | Workers Observability で観測可能だが閾値未定義 | 定常時のベースライン測定 |
| `codip-mvp` の可用性 SLI | **監視対象外**（smoke の probe に含まれない） | probe 対象への追加（公開範囲の判断を伴う） |
| RPO / RTO の実測値 | 目標値のみ（§8） | 復元訓練での実測 |

## 8. RPO / RTO

| 指標 | 目標 | 根拠 | 実測 |
| --- | --- | --- | --- |
| RPO（許容データ損失） | 24時間 | 日次 pg_dump（`neon-backup.yml`） | 未実測 |
| RPO（PITR 利用時） | Neon の保持窓に依存 | `create-neon-backup-evidence.js` が実測して記録 | 実行時に取得 |
| RTO（コードのみの復旧） | 30分 | `wrangler rollback` + smoke 再実行 | 未実測 |
| RTO（DB を含む復旧） | 4時間 | PITR restore + 検証 + human 承認 | 未実測 |

⚠️ **実測列が「未実測」である項目は、訓練で測るまで達成を主張しない。**
`docs/runbooks/restore-drill-record.md` に訓練の記録を残し、実測値が取れた時点で
本表を更新する。pg_dump からの `pg_restore` 型の訓練は**まだ一度も実施していない**ため、
暗号化 dump の復号可否とパスフレーズの有効性は未検証である。
