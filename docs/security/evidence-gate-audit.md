# 🔍 Evidence ゲート供給元監査（自己申告依存パターンの横断調査）

> 🗓️ 実施: 2026-08-11（T-Q3）｜ 種別: **read-only 調査記録**｜ 実施者: QA
> 関連: [監視・アラート runbook §1.2.1](../runbooks/monitoring.md)（Neon PITR の個別調査）/ [運用台帳](../operations/operations-ledger.md) / [通知テスト記録](../runbooks/notification-test-record.md)

---

## 📌 0. 目的と結論

`docs/runbooks/monitoring.md` §1.2.1 で、Neon backup 鮮度ゲートが「Neon API を一度も参照せず、定数同士を比較している」ことを記録した。**同型の構造が他にもあるなら、それらも「落ちないゲート」である**という仮説のもと、リポジトリ内の全 evidence ゲートについて「**検査対象の値は誰が供給しているか**」を1件ずつ判定した。

### 0.1 結論

全 26 ゲートを分類した。

| 分類 | 件数 | 意味 |
| --- | ---: | --- |
| 🟢 実測 | 11 | 対象システム（DB・HTTP・レジストリ）またはリポジトリ実体から値を取得している |
| 🟡 半実測 | 3 | 実測値だが、検査側と同じ run で生成された対象を見ている |
| 🔴 自己申告 | 12 | workflow input / GitHub Variables / スクリプト内定数など、**実行者または実装者が値を決められる** |

**最重要の発見は Neon PITR ではない。** `restoreDrillStatus is success`（`scripts/tools/check-neon-backup-evidence.js:158-162`）は、値の供給元が `scripts/tools/create-neon-backup-evidence.js:16` のハードコード既定値 `"success"` であり、これを上書きする `--restore-drill-status` フラグは**リポジトリ内のどの workflow からも渡されていない**。すなわちこの検査は「古い定数」ではなく、**構造的に失敗し得ない検査**である。復旧訓練の成否を保証していると読める名前を持ちながら、訓練が失敗しても成功と記録される。

### 0.2 本調査の対象外

- 是正の**実装**（T-Q3 は調査と記録まで。実装は所有者へ割り当てる）
- `scripts/tools/*neon-backup-evidence.js` と `.github/workflows/neon-backup.yml` の編集（T-B4 で backend が作業中のため read-only で参照した）
- 純粋な動作パラメータ（例: `data-ingestion.yml:28` の `CODIP_INGESTION_MAX_JOBS_PER_TICK`）。合否判定に使われないため evidence ゲートではない

---

## 📌 1. 分類の定義

| 記号 | 定義 | 判定の決め手 |
| --- | --- | --- |
| 🟢 **実測** | 対象システムから取得した値を検査する（API 応答・HTTP 応答・DB クエリ・ファイル実体） | スクリプトが `fetch` / `spawnSync` / `statSync` で外部の状態を読んでいる |
| 🟡 **半実測** | 実測値だが、検査側と**同じ run で生成された対象**を見ており、本番の状態とは独立に成立する | 生成 step と検査 step が同一 job にある |
| 🔴 **自己申告** | 実行者または実装者が値を決められる（workflow input / `vars.*` / スクリプト内定数） | 値の起点をたどると人間の入力かリテラルに到達する |
| ⬜ **未確認** | 供給元を行番号まで特定できなかった | 本監査では該当なし |

> ⚠️ 「たぶん実測」は 🟡 ではなく ⬜ 未確認と書く方針で調査した。結果として全 26 件を行番号付きで特定できたため、⬜ は0件である。

### 1.1 「検査対象のズレ」列について

分類軸（供給元）とは別に、**ゲート名が示唆する対象と、実際に検査している対象のズレ**を記録した。供給元が 🟢 でも、検査対象が本番の稼働実体ではなくリポジトリ内の宣言である場合、名前を信じた読み手に偽の安心を与える。この列は分類を格下げするものではなく、追加の注意喚起である。

---

## 📌 2. ゲート一覧

### 2.1 `.github/workflows/neon-backup.yml` — Neon backup 鮮度ゲート族

⚠️ 本節のファイルは **T-B4 で backend が是正実装中**。QA は read-only で参照した。

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 1 | `historyWindowHours meets minimum`（`check-neon-backup-evidence.js:128-130`） | `neon-backup.yml:43` `github.event.inputs.history_window_hours \|\| vars.CODIP_NEON_HISTORY_WINDOW_HOURS` → `:133` 既定値 `24` → `create-neon-backup-evidence.js:31` → 閾値は `check-*.js:5` の定数 `24` | 🔴 | Neon の `history_retention_seconds` を実際に 6 時間へ下げても、dispatch 時に `24` と入力すればゲートは通る | Neon API の `history_retention_seconds` を実測して記録する。閾値 24 は据え置き（[monitoring.md §1.2.1(5)](../runbooks/monitoring.md) に変更仕様あり）。**T-B4 で対応中** |
| 2 | `restoreDrillStatus is success`（`check-neon-backup-evidence.js:158-162`） | `create-neon-backup-evidence.js:16` のハードコード既定値 `restoreDrillStatus: "success"` → `:140` でそのまま evidence へ書き込み。上書き用 `--restore-drill-status`（`:37`）は**どの workflow からも渡されていない** | 🔴 | **何もしなくても常に通る。** 復旧訓練が失敗しても、訓練を一度も実施しなくても、この検査は success を報告する | 既定値 `"success"` を削除し、値が明示的に供給されない場合は evidence を書かずに非ゼロ終了する。訓練結果は訓練の実行記録から供給する |
| 3 | `lastPgDumpStatus is success`（`check-neon-backup-evidence.js:153-157`） | `create-neon-backup-evidence.js:15` のハードコード既定値 `pgDumpStatus: "success"` → `:137`。`--pg-dump-status`（`:35`）は未使用 | 🔴 | 同上。ただし #5 の実測が並存するため、pg_dump 自体の失敗は別経路で検知される（後述の緩和要因） | #2 と同じ。status を定数で持たず、dump step の実結果から供給する |
| 4 | `lastRestoreDrillAt is fresh`（30日以内。`check-neon-backup-evidence.js:143-151`、閾値は `:7`） | `neon-backup.yml:44` `github.event.inputs.restore_drill_at \|\| vars.CODIP_LAST_RESTORE_DRILL_AT` → `:143` `--restore-drill-at` | 🔴 | 復旧訓練を実施していなくても、dispatch 時に本日の日付を入力するか `vars.CODIP_LAST_RESTORE_DRILL_AT` を更新すれば「30日以内」を満たす | 訓練実施の証跡（訓練 workflow の run ID・成果物）を供給元とし、自己申告の日付は上書き扱いで記録だけ残す |
| 5 | `lastPgDumpAt is fresh` + artifact 実在・非空（`check-neon-backup-evidence.js:133-141` / `create-neon-backup-evidence.js:89-98`） | `create-neon-backup-evidence.js:90` `fs.statSync(filePath)`、`:92` サイズ0で例外、`:96` `stats.mtime` | 🟢 | — | 現状維持。**同一スクリプト内で唯一の実測経路**であり、#3 の緩和要因になっている |
| 6 | `owner` 必須（`check-neon-backup-evidence.js:16` の必須フィールド） | `neon-backup.yml:45` `github.event.inputs.owner \|\| vars.CODIP_BACKUP_OWNER` → `:134` 既定値 `release-manager` | 🔴 | 実在しない担当者名でも通る。ただし責任者の記録が目的であり、機械検証の対象として設計されていない | 分類は 🔴 だが是正不要。**証跡の記録**であって**状態の検査**ではないことを文書側で明示する |

> 💡 #2 と #3 は「定数 vs 定数」ですらない。**同じ定数が生成側と検査側の両方を通過している**（`create` が書いた `"success"` を `check` が読んで `"success"` と比較する）。ゲートを削除しても CI の合否は一切変わらない。

### 2.2 `.github/workflows/ci.yml` job `production-target-env`（L157-222）

この job は `vars.CODIP_*` を8個の readiness check へ流し込む。T-Q2 と同型の構造が**最も密集している箇所**である。

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 7 | Monitoring evidence 7項目（`Cloudflare Access evidence recorded` ほか。`production-evidence-report.js:241-247`、判定関数は `:120-125`） | `ci.yml:177-183` の `vars.CODIP_CLOUDFLARE_ACCESS_EVIDENCE` / `CODIP_MONITORING_CONTACTS` / `CODIP_CLOUDFLARE_ALERT_POLICY` / `CODIP_CLOUDFLARE_LOGS_EVIDENCE` / `CODIP_NEON_MONITORING_EVIDENCE` / `CODIP_SMOKE_MONITORING_SCHEDULE` / `CODIP_ROLLBACK_OWNER` → `production-evidence-report.js:44-52` | 🔴 | `evidenceState()` は「空でない」かつ「placeholder 正規表現（`:58-67`）に一致しない」だけを見る。**GitHub Variables に `ok` の2文字を入れれば7項目すべてが ✅ になる。** アラートポリシーが存在しなくても、監視連絡先が失効していても通る | 検査可能な識別子（Cloudflare policy ID、Actions schedule 文字列など）に形式を限定し、可能なものは API で存在確認する。少なくとも自由文字列を ✅ 判定の根拠にしない |
| 8 | `Backup/restore evidence recorded`（`production-evidence-report.js:248`） | `ci.yml:184` `vars.CODIP_BACKUP_RESTORE_EVIDENCE` → `production-evidence-report.js:54-56` | 🔴 | #7 と同じ。§2.1 の Neon 側ゲートとは独立しており、こちらは文字列の非空判定のみ | `release:check-neon-backup-evidence` の判定結果を供給元にする（証跡変数の二重管理をやめる） |
| 9 | `CODIP_NEON_BRANCH` / `CODIP_HYPERDRIVE_BINDING` 必須・非 placeholder（`validate-production-target-env.js:106-110`） | `ci.yml:169-170` の `vars.*` | 🔴 | 実際のデプロイ先と異なる branch 名・binding 名でも、placeholder 語（`:6-14`）を含まなければ通る。誤った Neon branch を指したまま production 判定が成立する | `wrangler.jsonc` の `hyperdrive[].binding` および Neon API の branch 一覧と突合する |
| 10 | `CODIP_DISABLE_TOKEN_AUTH=true` / `CODIP_TRUST_PROXY_AUTH=true`（`validate-production-target-env.js:121-127`） | `ci.yml:172-173` の `vars.*` | 🔴 | **認証方式の宣言と実際のデプロイ設定が乖離しても検知しない。** Variables が `true` でも、デプロイ済み Worker の実効設定が異なれば直接トークン認証が生きたまま通る | デプロイ後の実挙動で確認する（未認証リクエストが Access へリダイレクトされることを smoke で確認済み。その結果を判定に接続する） |
| 11 | `DATABASE_URL` / `CODIP_MIGRATION_DATABASE_URL` の形式（postgres・sslmode・非 localhost。`validate-production-target-env.js:42-67, 90-91`） | `ci.yml:164-165` の `secrets.*` | 🔴 | 形式のみの検査で**接続は行わない**。到達不能・権限不足の URL でもこのゲートは通る | 緩和要因あり: 同 job の `db:pg:check-drift`（#14）が同じ `DATABASE_URL` で実接続するため、後段で失敗する。ゲート名を「形式契約」と明示すれば足りる |
| 12 | `CODIP_BASE_URL` が production ホストと一致（`validate-production-target-env.js:93-104`、定数は `:15`） | `ci.yml:168` の `vars.CODIP_BASE_URL` だが、`:99-101` で `odip.mirai-dx-platform.com` に**ピン留め**されている | 🟢 | — | **良い型の実例。** 自己申告の値でも、期待値をコード側の定数に固定すれば実質的に改竄余地が消える。#9 もこの形に寄せられる |
| 13 | `production-placeholders`（routes / workers_dev / CODIP_BASE_URL。`check-production-placeholders.js:64-87`） | `check-production-placeholders.js:26-30` が `wrangler.jsonc` を読む | 🟢 | — | ⚠️ **検査対象のズレ**: 検査対象は「リポジトリの宣言」であって「デプロイ済み Worker の実設定」ではない。Dashboard 側で route を変更されても検知しない。文書側に明記する |
| 14 | PostgreSQL migration drift（`db:pg:check-drift`） | `check-postgresql-migration-drift.js:5` `process.env.DATABASE_URL` → `:12` `spawnSync` で Prisma を実 DB へ実行 | 🟢 | — | 現状維持。**本 job で最も強い実測** |
| 15 | PostGIS DDL 検査（`db:pg:check-postgis-ddl`、`ci.yml:212`） | `check-postgis-standard-record-ddl.js`（自前の I/O を持たず、呼び出し側の Prisma 接続経由） | 🟢 | — | 現状維持 |
| 16 | production smoke（`ci.yml:218,222`） | `release-smoke.js:21` `fetch(url, …)`、対象は `:79` `--base-url`（#12 でピン留め済み） | 🟢 | — | 現状維持 |
| 17 | Cloudflare build artifact（`ci.yml:206` → `:209`） | `check-cloudflare-build-artifact.js:18-26` が `.open-next/` の実ファイルを `existsSync`/`statSync` | 🟡 | 同一 job の `npm run cf:build` が生成した成果物を同一 job が検査する。**本番へデプロイされた成果物とは独立**。ビルドは通るがデプロイが古いままでも検知しない | デプロイ後に `wrangler deployments list` の結果と突合する（現状は release notes への手貼り運用。`production-evidence-report.js:311` 参照） |

### 2.3 `.github/workflows/ci.yml` job `release-gate` / 契約検査群

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 18 | 依存監査（本番グラフ、`ci.yml:58`） | `npm audit --audit-level=moderate --omit=dev`（レジストリ実測） | 🟢 | — | 現状維持 |
| 19 | 依存監査（全グラフ + allowlist、`ci.yml:65`） | `check-dependency-audit.js:131` `spawnSync("npm", ["audit","--json"])` | 🟢 | ⚠️ ただし `:17-48` の `ALLOWLIST` は人間の自己申告による抑止。`:129` の `--input` で保存済みレポートを評価する経路も存在する（CI では未使用） | **良い型の実例。** allowlist に `expires` / `owner` / `tracking` を必須化しており、自己申告に**時限**が付いている。`--input` は test 専用である旨をコメントで明示済み（`:11-12`） |
| 20 | production env 契約（synthetic） | `release-gate.js:63-70` がスクリプト内リテラルの `DATABASE_URL`（`example.com`）・`CODIP_ADMIN_TOKEN` を渡す。CI 版は `ci.yml:113-118` | 🔴 | **本番の env が壊れていてもこのゲートは通る。** 検査しているのは validator の挙動であって production の状態ではない | 是正不要だが名称の明確化を推奨。`release-gate.js:63` は既に `(synthetic)` と自己申告しており誠実。CI 側（`ci.yml:118`）には同等の注記がない |
| 21 | SQLite 前提の DB ゲート群（`db:migrate` / `db:check-duplicates` / `db:check-standard-record-policy` / `db:prune --dry-run`。`ci.yml:99-104`、`release-gate.js:27,30-48`） | `DATABASE_URL: file:./dev.db`（`release-gate.js:27`）。`check-standard-record-policy.js:18-32` が SQLite を実クエリ | 🟡 | 同一 run で作った使い捨て SQLite を検査している。**本番 PostgreSQL のデータ状態は一切見ていない。** 例えば本番の重複 `officialUrl` は検知されない | 分類は 🟡 で妥当。ゲート名から「本番データの検査」と誤読されないよう文書側で区別する |
| 22 | ドキュメント/API 契約検査群（`release:check-v1-contract` / `check-doc-api-contract` / `check-openapi-coverage` / `check-docker-contract` / `check-audit-contract` / `check-cloudflare-contract`。`ci.yml:80-87`） | いずれもリポジトリ内ファイルの実読み込み。例: `check-cloudflare-neon-contract.js:7-22`（`.env.example`・4 runbook・`wrangler.jsonc`・`src/lib/db.ts`・`schema.prisma` など13ファイル）、`check-audit-contract.js:17-20` | 🟢 | — | ⚠️ **検査対象のズレ**: 「文書と実装の整合」を検査しており、実装が正しいことは保証しない。設計どおりの役割であり是正不要 |
| 23 | GitHub Actions 契約（`check-github-actions-contract.js:8`） | workflow YAML の実読み込み（`readFileSync`） | 🟢 | — | ⚠️ **検査対象のズレ**: YAML の記述内容を検査するが、その job が実際に実行・成功したかは見ない |
| 24 | preview smoke（`ci.yml:121-136`） | `release-smoke.js:21` の `fetch` だが対象は同一 job で起動した `127.0.0.1:3100`（`ci.yml:127`） | 🟡 | 同一 run で起動した preview サーバを検査している。本番の挙動とは独立 | 分類どおり。#16（本番 smoke）と併存しているため実害は小さい |

### 2.4 `.github/workflows/production-smoke.yml`

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 25 | production readiness（`production-smoke.yml` の `production-status` step → `Enforce production readiness`） | `post-release-status.js:383` `probeUrl(args.productionUrl, PRODUCTION_PATHS)` の実 HTTP。既定 URL は `:18` の定数、対象パスは `:11` | 🟢 | — | **自己申告入力を持たない唯一のゲート。** `CODIP_PRODUCTION_URL` で上書き可能だが workflow は渡していない（`production-smoke.yml` の env は Access 用 secret 2件のみ） |
| 26 | 「連続2回以上の失敗で P1」の評価 | 供給元となる実装が存在しない。run 間の状態を保持しないことは `tests/unit/monitoring-runbook-contract.test.ts:113-118` で固定済み | 🔴 | **人間の記憶が唯一の供給元。** 前回 run の結果を機械が保持しないため、2回連続失敗しても自動では P1 と判定されない | backend への変更仕様は monitoring.md §1.1.4 に記載済み（T-B3） |

---

## 📌 3. 横断的な所見

### 3.1 自己申告が集中する場所

🔴 12件の供給元別内訳:

| 供給元 | 件数 | 該当 |
| --- | ---: | --- |
| GitHub Variables（`vars.*`） | 4 | #7（7変数を束ねた1行）・#8・#9・#10 |
| `workflow_dispatch` input | 3 | #1・#4・#6 |
| スクリプト内リテラル | 3 | #2・#3・#20 |
| GitHub Secrets（形式のみ検査） | 1 | #11 |
| 供給元となる実装が存在しない | 1 | #26 |

いずれも「人間が値を決め、その値を機械が検査する」構造であり、監査証跡としては循環している。

### 3.2 重大度の順位（QA 判断）

| 順位 | 対象 | 理由 |
| ---: | --- | --- |
| 1 | #2 `restoreDrillStatus` | 構造的に失敗し得ない。**復旧可能性という最も重い主張**を、検証なしで肯定している |
| 2 | #4 `lastRestoreDrillAt` | 訓練の実施そのものを自己申告に依存。#2 と組み合わさると「訓練を一度もせずに常時グリーン」が成立する |
| 3 | #7 monitoring evidence 7項目 | 2文字の文字列で7つの readiness check が通る。障害検知体制の主張が空洞化する |
| 4 | #1 `historyWindowHours` | T-B4 で是正中。retention 短縮を検知しない |
| 5 | #10 認証方式の宣言 | 宣言と実効設定の乖離を検知しない。ただし Access 経由の実挙動は別途確認済み |

### 3.3 参考にすべき「良い型」

リポジトリ内に、自己申告を安全に扱う実装が既に2つある。是正はこれらに寄せるのが最小変更である。

1. **期待値のピン留め**（#12 / `validate-production-target-env.js:99-101`）— 値は `vars.*` 由来でも、期待値をコード内定数に固定すれば実行者は合格させられない
2. **時限付き allowlist**（#19 / `check-dependency-audit.js:17-48`）— 自己申告による抑止を許すが、`expires` / `owner` / `tracking` を必須にし、期限切れをゲート失敗として扱う

### 3.4 分類が 🟢 でも安心できない場合

#13・#22・#23 は供給元としては実測だが、検査対象がリポジトリ内の宣言である。「wrangler.jsonc が正しい」ことと「デプロイ済み Worker が正しい」ことは別の命題であり、前者から後者は導けない。現在この差を埋めているのは #16（本番 smoke）と #25（定期 smoke）のみである。

---

## 📌 4. 残課題（本監査で実装しないもの）

| 項目 | 所有者候補 | 状態 |
| --- | --- | --- |
| #1 の是正（Neon API 実測） | backend | **T-B4 で実装中** |
| #2 / #3 の既定値 `"success"` 削除 | backend | 未着手。本監査で新規検出 |
| #4 の訓練証跡連携 | backend + ReleaseManager | 未着手。訓練実行の証跡そのものが未整備（`notification-test-record.md` と同型の記録様式が必要） |
| #7 / #8 の evidence 変数の形式限定 | backend | 未着手 |
| #9 / #10 の実設定突合 | backend + Infra | 未着手。Cloudflare API 読取権限が必要 |
| #17 のデプロイ成果物突合 | Infra | 未着手 |
| 秘密混入検査の対象拡大（表外） | QA | 未着手。docs 配下の秘密混入を落とすのは `tests/unit/monitoring-runbook-contract.test.ts:201-224` のみで、対象は runbook 4ファイルに限定される。ゲートの供給元問題ではなくゲートの不在のため §2 の表には載せない |
| #26 連続失敗の機械評価 | backend | monitoring.md §1.1.4（T-B3）に仕様記載済み |

> ⚠️ 本監査は **read-only 調査**である。上記の是正はいずれも `scripts/**` および `.github/workflows/**` の変更を伴い、これらは backend 所有のため QA は編集しない。

---

## 📌 5. 検証方法と再現手順

本監査の分類はすべて、リポジトリ内のファイルと行番号のみを根拠とする。外部システムへの書き込みは行っていない。

```bash
# 供給元の指紋スキャン（env / file / net・exec の出現数）
for f in scripts/tools/check-*.js scripts/tools/*-evidence*.js; do
  printf '%-46s env=%-3s file=%-3s net/exec=%s\n' "$(basename "$f")" \
    "$(grep -c 'process\.env' "$f")" \
    "$(grep -cE 'readFileSync|readdirSync|existsSync' "$f")" \
    "$(grep -cE 'fetch\(|https?://|execSync|spawnSync|execFileSync' "$f")"
done

# #2 の根拠: 上書きフラグがどの workflow からも渡されていないこと
grep -rn "restore-drill-status\|pg-dump-status" --include=*.yml --include=*.js . | grep -v node_modules
```

ドリフト検出テストは `tests/unit/evidence-gate-audit-contract.test.ts`（42件）に追加した。本ファイルの 🔴 / 🟡 行が供給元の根拠（`ファイル名:行番号`）を欠いた場合と、是正実装後に本ファイルの記述が古くなった場合に失敗する。

### 5.1 変異検査（テストが実際に何かを守っていることの確認）

本文書のテストは「通ること」ではなく「**壊れたときに落ちること**」で価値が決まるため、意図的な変異を入れて false に転じることを確認した。

| 変異 | 意図した検知対象 | 結果 |
| --- | --- | :---: |
| 「構造的に失敗し得ない検査」の記述を削除 | 是正されていないのに文書が是正済みと読める状態 | ✅ 1件 fail |
| §0.1 の 🔴 件数を 12→11 に改竄 | 要約と実データの乖離 | ✅ 1件 fail |
| 🔴 行(#7)の供給元セルから行番号引用を全削除 | 根拠なき分類 | ✅ 1件 fail |
| 🟡 行(#17)の供給元セルから行番号引用を削除 | 同上（🟡 も対象であること） | ✅ 1件 fail |

> ⚠️ 「🔴 行の引用を**1つだけ**消す」変異では落ちない。同一セルに別の行番号引用が残るためであり、意図した挙動である（供給元セルに1つ以上の引用があることを要求している）。

### 5.2 このテストは T-B4 完了時に落ちる

`create-neon-backup-evidence.js` の既定値 `"success"` が削除された時点で、「neon backup gate claims match the implementation」の2件が **意図的に失敗する**。これは欠陥ではなく、**本文書の §2.1 #2 / #3 を更新せよという信号**である。backend は是正実装時に本ファイルの当該行の更新を同じ変更単位へ含めること。

---

## 📌 6. Safety

- 🔐 本監査で秘密情報の値は一切参照・記録していない。`ci.yml` の `secrets.*` は**参照名のみ**を引用した
- 🔐 新たな秘密の混入は発見していない。`create-neon-backup-evidence.js:116,126` に artifact 識別子の秘密混入拒否があることを確認した
- 🔒 設定変更・デプロイ・API 書き込みはいずれも**未実施**
