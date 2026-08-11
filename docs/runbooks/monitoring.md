# 監視・アラート runbook

## 0. 現在のインシデント状態 (2026-08-04)

| 項目 | 実測 | 判定 |
| --- | --- | --- |
| Production URL | `https://odip.mirai-dx-platform.com` | 正式ターゲット |
| Cloudflare route / Worker | route・deploymentとも実在、`codip-production` は2026-08-05T04:58Zにmain `41400dc` 相当（Version `0eaaaafa-9995-4607-afdb-6e34801f9c9e`）へ更新済み | 稼働 |
| Access boundary | Cloudflare Access app `odip` が未認証アクセスを302でloginへ誘導 | 期待動作 |
| DB readiness | Access認証済みで `/api/ready=ready`、manual production smoke 75/75成功 (2026-08-02) | 稼働 |
| 定期smoke | Access service token設定済み。15分間隔 strict read-only probe成功（初回 2026-08-05T02:30Z run 30969524446、scheduled成功 03:41Z run 30972974222、デプロイ後 03:59Z run 30973772209） | 稼働 |
| Neon | mainへread-only直結成功、migration 2/2、孤児・重複・不正geometry 0 | DB rollback不要 |
| Backup | pg_dump初回成功（2026-08-04T21:05Z workflow_dispatch run 30950851419、暗号化artifact `codip-neon-pgdump-20260804T210642Z.dump.gpg`、証跡JSONあり）。scheduled初回は2026-08-06 03:17 JSTに検証予定 | 稼働（手動再検証） |

旧 `civilopendata.mirai-dx-platform.com` は現行ターゲットではない。DNS、Secrets、Access、DBを変更する前に、まず稼働deploymentとGit SHAを突き合わせる。

## 0.1 監視実態の read-only 再検証 (2026-08-11, Issue #90)

Issue #90 に対し、変更操作を伴わない read-only 検証をQAが実施した。**「確認済み」「BLOCKED（権限不足）」「未整備」を区別して記録する。実施していない確認を実施済みとして扱わない。**

### 0.1.1 確認できた事実（PASS）

| 対象 | 実測値 | 確認手段 |
| --- | --- | --- |
| Cloudflare zone | `mirai-dx-platform.com` status=`active`、type=`full`、plan=`Free Website`、activated 2026-06-30 | Cloudflare zones API (read) |
| 公開DNS | `odip.mirai-dx-platform.com` → A `104.21.57.65` / `172.67.189.96`、AAAA `2606:4700:3032::6815:3941` / `2606:4700:3037::ac43:bd60`（Cloudflare proxied edge） | 公開DNS問い合わせ |
| Access境界 | 未認証 `GET /api/health` が **302** を返し `winter-lake-f4c9.cloudflareaccess.com` のloginへ誘導。redirect metaは `auth_status=NONE` / `service_token_status=false` | 未認証HTTPプローブ |
| production smoke | scheduled runが15分間隔で継続。直近20件すべて `success`（2026-08-11T03:54Z〜12:58Z、run 31456833751〜31493821450） | GitHub Actions run一覧 |
| Neon project | `falling-dawn-93620497`、PG17、`aws-us-west-2`、PITR履歴 `history_retention_seconds=86400`（**24時間**）、storage 約83MB、quota reset 2026-09-01 | Neon API (read) |
| Neon 本番compute | `ep-still-feather-afoyv69p`（branch `br-solitary-breeze-afr5lrq4`）、1 CU固定、state=`active`、last_active 2026-08-11T12:55:09Z | Neon API (read) |
| ローカル品質ゲート | lint PASS / typecheck PASS / unit test 498 passed (59 files) PASS | `npm run lint` / `npm run typecheck` / `npm test` |

### 0.1.2 BLOCKED（read権限不足で検証不能）

Cloudflare zone APIが返した現行tokenの権限は `#dns_records:read` / `#analytics:read` / `#zone:read` / `#member:read` / `#organization:read` の5種のみで、Zero Trust・Workers・Notifications・Pagesのread scopeを含まない。Issue #90 記載の403はこのscope不足に一致する。

| 未検証項目 | 状態 | 解除に必要な最小read権限 |
| --- | --- | --- |
| Access application / policy / allowlist / service token登録状態 | BLOCKED | Account → **Access: Apps and Policies : Read**、**Access: Service Tokens : Read** |
| Cloudflare alert policy（`CODIP Worker Error Alert` 等）の実在と閾値 | BLOCKED | Account → **Notifications : Read** |
| Workers Logs / Traces / error rate | BLOCKED | Account → **Workers Observability : Read**（または Workers Scripts : Read + Logs 閲覧） |
| Worker route / custom domain / Pages の競合有無 | BLOCKED | Account → **Workers Scripts : Read**、**Pages : Read**、Zone → **Workers Routes : Read** |
| DNSレコード実体（proxied設定、record type） | BLOCKED | Zone → **DNS : Read**（tokenは `#dns_records:read` を持つがrecord一覧APIは本セッションのMCP経路に無い） |
| Web Analytics | BLOCKED | Account → **Account Analytics : Read** |

監査ログ経路でも独立検証を試みたが、2026-08-10〜08-12の `create` イベント35件はすべてWorkers tail操作であり、alert policy作成イベントは現れなかった。Cloudflare alerting APIの変更が監査ログ対象外である可能性と、policyが存在しない可能性の**双方が残る**ため、`docs/runbooks/alerts-and-notifications.md` の policy作成記録は本検証では**肯定も否定もできない**。Notifications : Read 付与後に `GET /alerting/v3/policies` で確認する。

### 0.1.3 未整備（権限ではなく設定そのものが存在しない）

以下は 2026-08-11 のQA read-only 検証時点の記録である。**検証記録は書き換えず**、その後に解消した項目は「解消」注記を追記して追跡する（解消の実装内容は §1.1.4 参照）。

| 項目 | 実態 | 根拠 |
| --- | --- | --- |
| production smoke 失敗時の通知 | 検証時点では**未整備**。`.github/workflows/production-smoke.yml` に `if: failure()` の通知step、Issue起票step、webhook呼び出しのいずれも存在しない。失敗表現は最終stepの `exit 1` によるrun失敗のみ →  **解消（2026-08-11, backend）**: `Report production smoke failure as an incident issue` step を追加し、incident Issue の自動起票・追記経路を実装 | workflow定義の全文確認。リポジトリ内workflow全体でも失敗時通知は `ci.yml` のtrace artifact upload 1件のみ |
| 失敗通知の受信経路 | 検証時点では**未整備かつリポジトリ内から検証不能**。現状はGitHubの既定通知（ユーザー個人のNotification設定）に暗黙依存しており、リポジトリ設定として担当・宛先を固定していない → **部分解消（2026-08-11, backend）**: incident Issue という**リポジトリ側に固定された経路**が成立。ただし「誰へ届くか」はIssue watcher設定に依存するため、当番の設定は引き続き人間作業（§1.1.3） | workflow定義にnotification先の記述なし |
| 連続失敗（`/api/ready` 継続失敗）の自動判定 | 検証時点では**未整備**。§1の異常判定は「連続2回以上」だが、production smokeは各runが独立で、run間の失敗連続数を保持・評価する仕組みが存在しない。P1相当の「継続失敗」を機械判定する主体はどこにも無い → **解消（2026-08-11, backend）**: 通知stepが `listWorkflowRuns` で直近runの conclusion を遡り、連続2回以上を P1 として起票する | `scripts/tools/post-release-status.js` は単一実行内で判定し `process.exit(1)` するのみ |
| Neon アラート（容量・接続数） | **未整備** | `docs/runbooks/alerts-and-notifications.md` §1 と一致 |
| 通知テストの受信記録 | **未整備**。受信時刻・担当者を記録する様式が存在しなかったため、§1.1.3 にテンプレートを新設した | — |

### 0.1.4 付随して判明した運用上の留意点（P3、本Issue範囲外）

- Neon本番computeは `pooler_enabled=false`（PgBouncer未使用）。Workers側の同時実行が増えた場合の接続枯渇を監視対象に含めるか、次サイクルで判断する。
- Neonに未使用のidle computeが4本残存（`ep-sweet-river-afwej471` / `ep-misty-rain-afqrpjly` / `ep-cold-credit-af49mzs0` / `ep-autumn-cell-af5g4shc`、2026-07-19〜08-04作成）。容量・コストの棚卸し対象。
- PITR履歴が24時間ちょうどで、§1.2のバックアップ鮮度ゲート既定値 `historyWindowHours >= 24` と境界一致しており余裕が無い。
- `.gitignore` に `.worktrees/` エントリが無い。現在はgitが登録済みworktreeパスをstatusから除外するため未追跡だが、worktree登録が解除されるとuntrackedとして一斉に現れ誤commitされ得る。GitHub Actionsランナーは `actions/checkout` が追跡ファイルのみを展開するため、CI上での重複lint・重複typecheckは**発生しない**（確認済み）。

## 1. 監視対象

| 対象 | 確認方法 | 異常判定 |
| --- | --- | --- |
| アプリ生存 | `GET /api/health` | 連続2回以上 200 以外 |
| DB接続 | `GET /api/ready` | 503 または応答遅延 |
| API契約 | `GET /api/openapi` | 200 以外、OpenAPI version欠落 |
| 管理保護 | 未認証 `GET /api/fetch-logs` | 401 以外 |
| ブラウザ | ダッシュボード表示、console error/warn | 主要画面の描画失敗、console error |

> 📌 **「連続」の判定主体（2026-08-11 実装）**: `scripts/tools/post-release-status.js` は1回の実行内でのみ判定して `process.exit(1)` するため、probe自身は連続性を知らない。連続性は `production-smoke.yml` の通知stepが担い、**GitHubのrun履歴から連続失敗回数を判定する**（`listWorkflowRuns` で直近10runの `conclusion` を新しい順に走査し、`failure` が途切れるまで数える）。連続2回以上でP1、初回はP2として起票する。
>
> この方式は workflow 側に永続状態を持たない。状態をrepository variable等へ書く方式は、runがキャンセル/タイムアウトすると書き込みが飛び、次のrunが古い値を読む「静かな腐敗」を起こすため採用しない（GitHubのrun履歴を単一の真実とする）。ただし直近10runより長い連続失敗は10で頭打ちになる（P1判定には影響しない）。

## 1.1 アラート運用

実通知先は本番Cloudflare/Neon作成時に確定する。未確定の間は、本表を暫定SLO/エスカレーション基準として扱い、確認結果を `docs/16-release-readiness-checklist.md` と `docs/release-notes.md` に記録する。

| 重大度 | 条件 | 初動目標 | 初動担当 | エスカレーション | 復旧目標 |
| --- | --- | ---: | --- | --- | ---: |
| P1 | `/api/ready` 503継続、認証バイパス疑い、データ破損疑い、Cloudflare本番routing障害 | 15分 | ReleaseManager / DevOps | CTO判断でrollback runbookへ移行 | 60分 |
| P2 | 主要API 5xx増加、Workers error増加、Neon接続遅延、read-only smoke失敗 | 30分 | DevOps / QA | SecurityまたはDB影響時はCTOへ即時共有 | 4時間 |
| P3 | console warn、低頻度の外部API timeout、監査ログ欠落疑い、性能劣化傾向 | 1営業日 | QA / Developer | 週次改善Issueへ登録 | 次回改善サイクル |

| 通知経路 | 現状（2026-08-11 QA再検証） | 本番化時の完了条件 |
| --- | --- | --- |
| Cloudflare Workers Logs / Traces | **BLOCKED（権限不足）** — 現行tokenにWorkers Observability readが無く、`cloudflare-observability` MCPも未認証（OAuth要） | error rate、例外sample、対象deploy idをEvidenceへ記録 |
| Cloudflare alert / Web Analytics | **要再確認** — `alerts-and-notifications.md` は policy `CODIP Worker Error Alert` を2026-08-10に作成・テスト送信済みと記録するが、QAはNotifications read権限が無く**独立検証できていない**。監査ログにも該当作成イベントは現れなかった（alerting変更が監査ログ対象外の可能性あり） | Notifications read付与後に `GET /alerting/v3/policies` で実在・閾値・宛先を確認し、通知テスト受信時刻を §1.1.3 テンプレートへ記録 |
| Neon monitoring | 監視データはread可（project/branch/compute/PITR/容量を2026-08-11に取得）。**アラートは未設定** | 容量80%・接続数80%のアラートを設定し、通知テスト受信を記録 |
| GitHub Actions | **通知経路は実装済み（2026-08-11）**。`production-smoke.yml` の `Report production smoke failure as an incident issue` step が、run失敗時に `incident` label 付きIssueを起票する（既存openがあればコメント追記、連続2回以上でP1昇格）。外部webhookやそのSecretは使用しない。**未完了は「誰へ届くか」**で、Issue watcher / 当番の設定は人間作業として残る | 通知テストの受信時刻・受信者を §1.1.3 テンプレートへ記録し、当番を運用台帳へ登録 |

> 📌 **正本の整合について**: 通知設定の詳細手順は `docs/runbooks/alerts-and-notifications.md` を正本とする。本表は「QAが read-only で独立検証できた範囲」を記録するものであり、両者が食い違う場合は**検証手段が明記されている側**を採用する。2026-08-11時点で、Cloudflare alert policyについては両文書の記述が一致していない（上表参照）。

### 1.1.1 定期production smoke

`.github/workflows/production-smoke.yml` は毎時7/22/37/52分（15分間隔）、および手動dispatchで次を実行する。定時集中を避け、実行中の手動確認をscheduled runでキャンセルしない。

- `odip.mirai-dx-platform.com` のDNS、`/api/health`、`/api/ready` をstrict read-only判定
- 共有preview停止は本番判定へ混ぜない (`--allow-preview-down`)
- 結果をGitHub Actions Summaryと14日保持artifactへ保存
- readiness失敗時はworkflowを失敗させ、GitHub Actions通知対象にする
- run失敗時は `incident` label 付きIssueを起票し、連続失敗回数に応じてP1/P2を判定する（下記）

odipはCloudflare Access配下のため、workflowはGitHub Actions Secret `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`（Access service token）をprobeへ付与する。**2026-08-05にservice token・Service Auth policy・Secrets登録を完了し、workflow_dispatchで初回成功（run 30969524446）を確認済み**。以降は15分間隔のscheduled runがstrict判定を行う。token未設定時は302を検知し「Cloudflare Access boundary」の診断と設定手順を出力して失敗する（フォールバック）。Cloudflare/Neon API tokenやDB接続文字列は使用しない。

**失敗時のincident Issue（2026-08-11 実装）**

| 項目 | 挙動 |
| --- | --- |
| 発火条件 | job内のいずれかのstep失敗（`if: failure()`）。probe自体の異常終了も含む |
| 実装 | `actions/github-script`（commit SHA固定）。job権限は `contents: read` + `issues: write` のみ |
| 重複防止 | `production-smoke` label のopen Issueが在れば新規作成せずコメント追記。15分間隔のprobeがIssueを量産しない |
| 重大度 | 連続1回=P2、連続2回以上=P1（既存Issueへは `P1` labelを追加して昇格） |
| 本文 | 重大度・連続失敗回数・失敗runのURL・検知時刻のみ。probe出力は14日保持artifact側に置き、Secret/認証情報/PIIをIssueへ持ち込まない |

外部webhookやチャット連携は**採用しない**。通知先Secretの追加は人間承認事項（Approval PR / CLAUDE.md §17）であり、`GITHUB_TOKEN` の既定権限で完結するIssue起票に限定している。

Issue起票までは自動化されたが、**その Issue を誰が見るか**（watcher・当番）はリポジトリ側の人間設定である。当番とテスト通知の受信時刻を `CODIP_SMOKE_MONITORING_SCHEDULE` / `CODIP_MONITORING_CONTACTS` の証跡へ記録し、**受信確認は未実施の残課題**として運用台帳（`docs/operations/operations-ledger.md`）に記録する。

### 1.1.2 SLO目標（暫定）

| 指標 | 目標 | 計測方法 |
| --- | --- | --- |
| 可用性 | 月間 99.9% | production-smoke 成功割合（15分毎） |
| `/api/ready` | 監視時刻 100% `status=ready`・`db=ok` | `release:post-release-status --strict-production` |
| 応答時間 | P95 5秒以内（probeはmax 5000ms） | 各probeのresponseTimeMs |
| 検知 | P1: 15分以内に検知・初動 | production-smoke失敗 + 通知 |

エスカレーションは§1.1のP1/P2/P3表を正とし、復旧目標はP1=60分、P2=4時間、P3=次回改善サイクルとする。通知先・通知テストは未設定のため、2026-08-05時点では「監視は成立、通知はGitHub Actionsデフォルトに依存」と記録する。

**2026-08-11 再確認（Issue #90）**: 「検知 P1: 15分以内に検知・初動」の計測方法欄にある「production-smoke失敗 + 通知」のうち、**通知（incident Issue起票）と連続失敗判定は実装済み**（§1.1.1 / §1 注記）。したがって**「検知」までは機械的に計測可能**になった（失敗run時刻とIssue作成時刻の差＝probe間隔15分以内）。

ただし**「初動」は依然として計測不能**である。Issueに気付いて一次対応を開始した時刻を記録する主体が居らず、watcher・当番が未設定のためである（§1.1.3）。達成度を数値報告する場合は「検知＝計測可能／初動＝未計測」を併記する。

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

### 1.1.3 通知テスト記録

通知経路の合否は「送信APIが success を返したか」ではなく、**人間が実際に受信できたか**で判定する。受信時刻・受信確認者を記録する非Secretのテンプレートと台帳を [`docs/runbooks/notification-test-record.md`](./notification-test-record.md) に置く。

- 実通知テストの発火（意図的失敗run、Dashboardのテスト送信）と受信確認は**人間操作を要する**ため、QAは手順と記録様式の整備までを担当する。
- 通知先の追加・変更・ローテーションは人間承認事項（Approval PR 対象）であり、本runbookの手順には含めない。
- 2026-08-11時点の台帳は `cloudflare-alert-policy = NOT RUN（受信記録なし）`、`github-actions-failure = BLOCKED（通知先未確定）`、`neon-alert = BLOCKED（未設定）`。
- 同日の incident Issue 実装により、`github-actions-failure` のBLOCKED理由は「通知先未確定」から**「受信テスト未実施」**へ変わった。台帳の更新は実受信の確認をもって行う（実装だけでは判定を進めない）。
- **意図的な失敗runの発火はこのrunbookの手順に含めない。** 本番probeを故意に落とす行為は運用ノイズと誤検知を生む。受信テストは `workflow_dispatch` で通知経路のみを試す方法か、次回の実失敗を利用する方法を人間が選択する。

### 1.1.4 backend への変更仕様（実装済み。QAが仕様を起票し backend が実装）

`/api/ready` の継続失敗をP1として通知するために、QAが次の3点を仕様として起票した。いずれも `.github/workflows/**` / `scripts/**` / `.gitignore` の変更でQAの所有範囲外であったため、backend・CTOが実装した。**3点とも 2026-08-11 に実装完了**。

| # | 対象 | 変更仕様 | 目的 | 状態 |
| --- | --- | --- | --- | --- |
| 1 | `.github/workflows/production-smoke.yml` | `Enforce production readiness` step の後に `if: failure()` の通知stepを追加する。最小構成は `actions/github-script`（SHA固定）による重複防止付きIssue起票（`label: incident,P1`、同一labelのopen issueがあればコメント追記のみ） | 失敗がGitHub既定通知（個人設定依存）以外の、リポジトリとして固定された経路へ届く | **実装済み**（backend）。webhook宛先は採用せず、`GITHUB_TOKEN` の `issues: write` のみで完結させた。外部通知先Secretの追加はCLAUDE.md §17 のApproval PR対象のため、本実装では扱わない |
| 2 | `.github/workflows/production-smoke.yml` または `scripts/tools/` | 連続失敗回数の永続化。案A: 失敗時にrun成果をrepository variable / Issue本文へ記録し、直前runの結果と突き合わせて連続2回目でP1昇格。案B: `gh run list --workflow "Production Smoke" --status failure` 相当で直近N runを参照し連続性を判定 | §1の異常判定「連続2回以上」を機械評価可能にする | **実装済み（案B採用）**（backend）。採用理由は下記 |
| 3 | `.gitignore` | `.worktrees/` を追加 | worktree登録解除時に `.worktrees/**` がuntrackedとして現れ、`git add -A` で誤commitされる事故を予防する（CI側は `actions/checkout` が追跡ファイルのみ展開するため影響なし＝検証済み） | **実装済み**（CTO, `c0ccf94`） |

**案B（run履歴参照）を採用した理由**

| 観点 | 案A（永続状態） | 案B（run履歴） |
| --- | --- | --- |
| 状態の正しさ | run がキャンセル・タイムアウト・権限失敗で終わると書き込みが飛び、次のrunが**古い値を読む**。しかもその腐敗は障害発生時にしか表面化しない | GitHubのrun履歴が単一の真実。workflow側は状態を持たない純関数で、腐敗する状態が存在しない |
| 障害時の信頼性 | 状態の書き込み自体が障害の影響を受ける（最も信頼したい瞬間に最も壊れやすい） | 読み取りのみ。判定はGitHub API側の記録に依存する |
| 追加権限 | repository variable の書き込み権限（`GITHUB_TOKEN` 既定では不足）またはIssue本文の状態管理が必要 | `actions: read` 相当。`GITHUB_TOKEN` の既定権限内 |
| 限界 | 上限なし | 参照する直近run数（現状10）で頭打ち。P1判定（2回以上）には影響しない |

「障害時に最も信頼したい仕組みが、障害の影響を受けて壊れる」構造を避けることを最優先し、案Bを採用した。

### 1.2 Neon backup鮮度ゲート

`CODIP_BACKUP_RESTORE_EVIDENCE` は人間向けの証跡名だけを検査する。PITR window短縮や `pg_dump` 未実行を機械的に落とすため、production/stagingの定期バックアップジョブはSecretを含まないJSONを `CODIP_NEON_BACKUP_EVIDENCE_JSON` として渡し、次のゲートを実行する。

本番向けの定期ジョブは `.github/workflows/neon-backup.yml` で管理する。`CODIP_NEON_PGDUMP_DATABASE_URL` / `CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE` Secret、main endpoint hostnameを保持する `CODIP_NEON_PGDUMP_HOST` Variable、`CODIP_LAST_RESTORE_DRILL_AT` Variableまたはdispatch入力が未設定の場合、workflowはfail-closedで失敗する。証跡branchは`main`に固定し、Secret URLから抽出したhostnameが期待値と一致した場合だけdumpを開始する。

```bash
npm run release:create-neon-backup-evidence -- \
  --project-id falling-dawn-93620497 \
  --branch main \
  --endpoint-host '<main-endpoint>.neon.tech' \
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
  "branch": "main",
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

#### 1.2.1 PITR retention とゲート閾値の関係（2026-08-11 調査。設定変更は未実施）

背景: 実測の `history_retention_seconds` が 86400秒（24時間）で、ゲート既定値 `historyWindowHours >= 24` と**境界一致**している。この余裕ゼロ状態を read-only で調査した結果を記録する。

##### (1) 実測値（read-only、2026-08-11）

| 項目 | 実測値 | 取得元 |
| --- | --- | --- |
| Neon organization plan | `launch` | Neon API organization 情報 |
| project `falling-dawn-93620497` の `history_retention_seconds` | `86400`（24時間） | Neon API project 情報 |
| production branch | `br-solitary-breeze-afr5lrq4`（`main`、`protected: true`） | Neon API branch 一覧 |
| project 合成ストレージ量 | `83,317,464` bytes（約79.5 MiB） | Neon API `synthetic_storage_size` |

##### (2) 仕様（Neon 公式ドキュメント `docs/introduction/history-window.md`）

| プラン | history window 既定 | 上限 |
| --- | --- | --- |
| Free | 6時間 | 6時間（history 1GB上限） |
| **Launch（現行）** | **1日** | **7日** |
| Scale | 1日 | 30日 |

- 設定単位は project 全体（全branchへ一律適用）。API property は `history_retention_seconds`（7日 = `604800`）。
- `0` にすると instant restore と Time Travel が**無効化**される。
- 課金は History storage として **$0.20/GB-month**（Launch / Scale）。通常のブランチデータ storage とは別枠。

##### (3) 結論(a): 24時間は「下限固定」ではなく「有料プランの既定値」

Launch プランでは `0`〜`604800` 秒の範囲で**人間が任意に変更できる**。したがって 24時間は Neon 側が保証する下限ではなく、**変動しうる値**である。retention を下げる操作が行われれば、実際の復旧可能範囲は 24時間未満になりうる。

##### (4) 結論(b): ゲート既定値を 23h へ下げるのは不適切。真の欠陥は「ゲートが実測しないこと」

`historyWindowHours` の値は Neon API から取得されていない。呼び出し側が渡した定数がそのまま記録され、同じく定数の閾値と比較されている。

```text
.github/workflows/neon-backup.yml
  history_window_hours="${CODIP_NEON_HISTORY_WINDOW_HOURS:-24}"   ← 環境変数未設定なら定数 24
        ↓ --history-window-hours で受け渡し
scripts/tools/create-neon-backup-evidence.js
  受け取った値を evidence JSON の historyWindowHours へそのまま記録（Neon API を参照しない）
        ↓
scripts/tools/check-neon-backup-evidence.js
  historyWindowHours >= DEFAULT_MIN_HISTORY_WINDOW_HOURS（= 24）   ← 定数 vs 定数
```

このため次が成立する。

- Neon 側の retention が 12時間へ下げられても、evidence には `24` が記録され、**ゲートは PASS する**（偽陰性）。
- 閾値を 23h へ下げても `24 >= 23` で PASS。検知力は増えず、要求水準だけが緩む。
- 現状のゲートは「PITR window短縮を機械的に落とす」という §1.2 冒頭の目的を**果たしていない**。

> ⚠️ よってこの問題は「境界一致でいつか落ちる時限爆弾」ではなく、「**実際に短縮されても落ちない検知漏れ**」である。優先すべき是正は閾値調整ではなく実測値の取得。

##### (5) backend への変更仕様（未実装。QAは実装しない）

| # | 対象 | 変更内容 | 目的 |
| --- | --- | --- | --- |
| 1 | `scripts/tools/create-neon-backup-evidence.js` | Neon API `GET /projects/{project_id}` の `history_retention_seconds` を取得し、`historyWindowHours` へ実測値を格納する。`--history-window-hours` は API 取得失敗時の明示 override としてのみ残し、override 使用時は evidence に `historyWindowSource: "override"` を記録する | 定数比較を実測比較へ変え、retention 短縮を検知可能にする |
| 2 | `scripts/tools/check-neon-backup-evidence.js` | 閾値 `DEFAULT_MIN_HISTORY_WINDOW_HOURS = 24` は**据え置く**。`historyWindowSource` が `override` の場合は検証を PASS ではなく警告付き（または fail-closed）で扱う | 実測値が入って初めて境界 24 が本来の意味を持つ。override による検知回避を防ぐ |
| 3 | `.github/workflows/neon-backup.yml` | Neon API 読み取り用の read-only token を Secret として参照（値は人間が設定）。未設定時は #1 の override 経路へ fail-closed で退避 | 権限追加は人間承認事項のため、未設定でもジョブが壊れないようにする |

##### (6) retention 引き上げの判断材料（実行しない）

| 論点 | 判定 |
| --- | --- |
| プラン変更の要否 | **不要**。7日（`604800`）は現行 Launch プランの上限内 |
| 課金への影響 | **あり**。History storage が $0.20/GB-month で従量課金される。retention を長くするほど保持 WAL が増える |
| 増分費用の見積り | **算出不能**。History 単独の使用量を read-only で取得できていない（`synthetic_storage_size` はプロジェクト合成値であり History 内訳ではない）。実際の増分は WAL 生成量に依存する |
| Neon の推奨 | 公式ドキュメントは production ワークロードについて 7日への延長を推奨（数日気付かれない人為ミスからの復旧、保持要件対応） |
| 本 runbook の判断 | 現行 24時間は「気付くまでに1日以上かかった誤操作は復旧不能」を意味する。延長は妥当だが、**費用構造に影響するため人間承認事項**として扱い、QA / CTO セッションでは実行しない |

> 🔒 本調査で使用した Neon API token は project に対する変更権限を持つが、T-Q2 の禁止事項に従い read-only 操作のみを実施した。`history_retention_seconds` の変更、branch 作成・削除、compute 設定変更はいずれも**未実施**である。

## 2. ポストリリース状態確認

Cloudflare / Neon の実リソースを変更せず、DNS、HTTP到達性、応答時間、`/api/ready` のDB状態を読み取り専用で確認する。production DNSが未解決の場合、通常モードでは「本番未接続」として記録し、共有previewの健全性を確認できればコマンドは成功する。

```powershell
npm run release:post-release-status -- --preview-url http://192.168.0.185:3100 --production-url https://odip.mirai-dx-platform.com --max-response-ms 5000
```

本番Custom Domain、DNS、Access、Secrets、Hyperdrive、Neon branchの作成・承認後は、production未接続を失敗扱いにする。

```powershell
npm run release:post-release-status -- --strict-production --production-url https://odip.mirai-dx-platform.com --max-response-ms 5000
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
