# 🔍 Evidence ゲート供給元監査（自己申告依存パターンの横断調査）

> 🗓️ 実施: 2026-08-11（T-Q3）｜ 種別: **read-only 調査記録**｜ 実施者: QA
> 🔁 更新: 2026-08-11（T-B4 / Issue #126・#127）｜ 更新者: backend｜ 範囲: §2.1 の是正済み行と、それに連動する件数・内訳・残課題のみ。**分類の方法論（§1）と §2.2 以降の判定は QA の記録のまま変更していない**
> 🔁 更新: 2026-08-12（Issue #128・#129 / T-B7）｜ 更新者: backend（本ファイルの当該範囲は CTO により backend へ所有権移管）｜ 範囲: §2.2 #7・#8、§2.4 #16 の是正反映と §2.2 の注記追加、および **§2.5 の新設**。**分類（🟢/🟡/🔴）と §0.1 の件数・総数 26 は変更していない**（供給元の性質は是正で変わっていないため）
> 🔁 更新: 2026-08-12（Issue #134）｜ 更新者: backend｜ 範囲: §2.3 #22 の分類を **🟢 → 🟡** へ格下げし、§0.1 の内訳・§2.5（S22 追加）・§3.4 を連動更新。総数 26 と採番は変えていない。**格下げは新たな欠陥の発生ではなく、群の最弱（振る舞いの主張をコメント照合で見ている箇所）に分類を合わせた再評価である**
> 🔁 更新: 2026-08-12（T-B12）｜ 更新者: backend｜ 範囲: §2.2 の注記へ結線検査の追記、§2.5 に **SB12（📣 宣言）** を追加、**§3.5 の新設**（欠陥クラス）。分類・件数・採番は変更していない
> ⚠️ 本監査の主張が実態と一致していることは `tests/unit/evidence-gate-audit-scenarios.test.ts` が実行検査する（§2.5）。**是正の反映漏れは CI で落ちる。**
> 関連: [監視・アラート runbook §1.2.1](../runbooks/monitoring.md)（Neon PITR の個別調査）/ [運用台帳](../operations/operations-ledger.md) / [通知テスト記録](../runbooks/notification-test-record.md) / [復旧訓練 実施記録](../runbooks/restore-drill-record.md)

---

## 📌 0. 目的と結論

`docs/runbooks/monitoring.md` §1.2.1 で、Neon backup 鮮度ゲートが「Neon API を一度も参照せず、定数同士を比較している」ことを記録した。**同型の構造が他にもあるなら、それらも「落ちないゲート」である**という仮説のもと、リポジトリ内の全 evidence ゲートについて「**検査対象の値は誰が供給しているか**」を1件ずつ判定した。

### 0.1 結論

全 26 ゲートを分類した。

| 分類 | 件数 | 意味 |
| --- | ---: | --- |
| 🟢 実測 | 12 | 対象システム（DB・HTTP・レジストリ）またはリポジトリ実体から値を取得している |
| 🟡 半実測 | 4 | 実測値だが、検査側と同じ run で生成された対象、または主張そのものではなくその宣言を見ている |
| 🔴 自己申告 | 10 | workflow input / GitHub Variables / スクリプト内定数など、**実行者または実装者が値を決められる** |

> 🔁 上表は T-B4 是正後の値である。QA 調査時点（2026-08-11 午前）は 🟢 11 / 🟡 3 / 🔴 12 だった。Issue #126 で #1 が、Issue #127 で #3 が 🔴 → 🟢 へ移動している。
> 🔁 Issue #134 で #22 を 🟢 → 🟡 へ格下げした。総数 26 と採番は変えていない（新規行の採番は QA の判断。§4 参照）。

**最重要の発見は Neon PITR ではなかった。** `restoreDrillStatus is success`（`scripts/tools/check-neon-backup-evidence.js:241-245`）は、調査時点では値の供給元が `create-neon-backup-evidence.js` のハードコード既定値 `"success"` であり、これを上書きする `--restore-drill-status` フラグは**リポジトリ内のどの workflow からも渡されていなかった**。すなわちこの検査は「古い定数」ではなく、**失敗し得ない構造**を持っていた。復旧訓練の成否を保証していると読める名前を持ちながら、訓練が失敗しても、一度も実施しなくても success と記録される。

Issue #127 でこの構造は撤去した。既定値を削除し、`--restore-drill-status` と `--restore-drill-record` が未指定なら証跡を書かずにジョブを落とす。**それでも #2 の分類は 🔴 のままである**。復旧訓練は人間の手順であり、CI が観測できる対象ではないためで、是正の到達点は「実測へ変える」ことではなく「**申告に追跡可能な裏付けを要求し、無申告を緑にしない**」ことである（[復旧訓練 実施記録](../runbooks/restore-drill-record.md)）。

### 0.2 本調査の対象外

- 是正の**実装**（T-Q3 は調査と記録まで。実装は所有者へ割り当てる）
- `scripts/tools/*neon-backup-evidence.js` と `.github/workflows/neon-backup.yml` の編集（T-Q3 の時点では T-B4 で backend が作業中のため read-only で参照した。是正は Issue #126 / #127 として backend が実装済み）
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

⚠️ 本節のファイルは QA 調査時点で **T-B4 で backend が是正実装中**だった。QA は read-only で参照し、その後 backend が Issue #126 / #127 の是正を実装したうえで本節を更新した（行番号は是正後のもの）。

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 1 | `measured PITR retention meets minimum`（`check-neon-backup-evidence.js:162-166`） | `create-neon-backup-evidence.js:142` `measureHistoryRetention()` が Neon control-plane API を `fetch` し、`:194` で `project.history_retention_seconds` を読む。測定できなければ `:224-226` で証跡を書かずに異常終了する。閾値は `check-*.js:5` の定数 `24` | 🟢 | — | **是正済み（Issue #126）。** dispatch input は `historyWindowHoursDeclared` として記録のみへ降格し、実測との差は非ゲートの `declared window agrees with measurement`（`check-*.js:203-207`）で可視化する。閾値 24 は据え置き（[monitoring.md §1.2.1(5)](../runbooks/monitoring.md) に変更仕様あり） |
| 2 | `restoreDrillStatus is success`（`check-neon-backup-evidence.js:241-245`） | `neon-backup.yml:60` の `inputs.restore_drill_status` または `vars.CODIP_LAST_RESTORE_DRILL_STATUS` → `:186` `--restore-drill-status` → `create-neon-backup-evidence.js:297`。既定値は撤廃され、未指定なら `:277-279` で異常終了する | 🔴 | 訓練を実施せずに `success` と申告すればゲートは通る。**ただし「何もしない」では通らない**: 値が無ければ `neon-backup.yml:105` の `Validate backup inputs` でジョブが落ちる | 分類は 🔴 のまま（**是正漏れではない**）。訓練は人間の手順であり実測へ変換できない。到達点は申告の裏付けであり、`--restore-drill-record` で [復旧訓練 実施記録](../runbooks/restore-drill-record.md) の台帳行を参照させ、`check-*.js:256-260` が非ゲートで可視化する |
| 3 | `lastPgDumpStatus` の success 判定（`check-neon-backup-evidence.js:236-240`） | `create-neon-backup-evidence.js:255-256` — #5 の `fs.statSync`（`:119-121` で通常ファイルかつ非空を確認）が成功した場合にのみ `"success"` を導出し、供給元を `lastPgDumpStatusSource: "artifact-stat:regular-file,size>0"` として記録する。申告値が実測と矛盾すれば `:261` で異常終了する | 🟢 | — | **是正済み（Issue #127）。** #5 の実測経路を status の供給元へ接続した。workflow から定数 `success` を渡す案は採らなかった（定数の置き場所が JS から YAML へ移るだけで分類は 🔴 のまま） |
| 4 | `lastRestoreDrillAt is fresh`（30日以内。`check-neon-backup-evidence.js:223-227`、閾値は `:7`） | `neon-backup.yml:59` の `inputs.restore_drill_at` または `vars.CODIP_LAST_RESTORE_DRILL_AT` → `:185` `--restore-drill-at` | 🔴 | 復旧訓練を実施していなくても、dispatch 時に本日の日付を入力するか `vars.CODIP_LAST_RESTORE_DRILL_AT` を更新すれば「30日以内」を満たす | 訓練実施の証跡（訓練 workflow の run ID・成果物）を供給元とし、自己申告の日付は上書き扱いで記録だけ残す。現状の緩和は #2 と同じく台帳参照のみ |
| 5 | `lastPgDumpAt is fresh` + artifact 実在・非空（`check-neon-backup-evidence.js:213-217` / `create-neon-backup-evidence.js:118-128`） | `create-neon-backup-evidence.js:119` `fs.statSync(filePath)`、`:121` サイズ0で例外、`stats.mtime` を `lastPgDumpAt` へ | 🟢 | — | 現状維持。QA 調査時点で**同一スクリプト内で唯一の実測経路**であり、Issue #127 でこの経路を #3 の供給元へ接続した（#1 の Neon API 実測は Issue #126 で追加） |
| 6 | `owner` 必須（`check-neon-backup-evidence.js:10-20` の必須フィールド） | `neon-backup.yml:62` の `inputs.owner` または `vars.CODIP_BACKUP_OWNER` → `:175` 既定値 `release-manager` | 🔴 | 実在しない担当者名でも通る。ただし責任者の記録が目的であり、機械検証の対象として設計されていない | 分類は 🔴 だが是正不要。**証跡の記録**であって**状態の検査**ではないことを文書側で明示する |

> 💡 QA 調査時点で #2 と #3 は「定数 vs 定数」ですらなかった。**同じ定数が生成側と検査側の両方を通過していた**（`create` が書いた `"success"` を `check` が読んで `"success"` と比較する）。当時はゲートを削除しても CI の合否は一切変わらなかった。Issue #127 で #3 は artifact の実測へ、#2 は「未指定ならジョブを落とす」申告へ置き換わり、いずれも合否を左右する経路を持つ。
> 🔍 **是正で追加された判定行（本表では採番していない）**
> Issue #126 / #127 は `check-neon-backup-evidence.js` に判定行を追加した。総数 26 という QA の採番を保つため本表へは加えず、ここに分類のみ記す。正式な採番と再監査は QA の判断とする（§4 参照）。
> - `historyRetentionSecondsMeasured present`（`:152-158`）🟢 — 実測が無ければ落ちる。宣言値へのフォールバックを持たない
> - `historyRetentionMeasuredAt ISO date` / `is fresh`（`:177-186`）🟢 — 更新されない実測が緩慢な自己申告へ劣化することを防ぐ
> - `historyRetentionProjectId matches projectId`（`:191-195`）🟢 — 別プロジェクトを測って緑にすることを防ぐ
> - `declared window agrees with measurement`（`:203-207`）— 非ゲート（ℹ️）。宣言と実測の乖離を可視化するのみ
> - `lastPgDumpStatus was measured, not declared`（`:251-255`）/ `restoreDrillRecord referenced`（`:256-260`）— 非ゲート（ℹ️）。生成側が既に fail-closed のため、ここで落とすと手書き JSON しか捕まえられない
> - `restoreDrillStatusSource present`（必須フィールド一覧 `:10-20` に追加）🔴 — **ゲート**。#6 `owner` と同じく状態の検査ではなく**証跡の完全性**の検査であり、実測へ変換できる対象ではない。ここで落とすのは「訓練が失敗した文書」ではなく「供給元を記録していない文書」である
> - `restoreDrillStatusSource is a recognised provenance`（`:266-272`）— 非ゲート（ℹ️）。値が語彙 `:28` に属するかだけを見る。**「measured かどうか」を見ていない**のは、訓練成否に実測経路が存在しないためで、`lastPgDumpStatus was measured, not declared` と同じ文面にすると、唯一正直な状態（`declared:--restore-drill-status`）を欠陥として表示してしまう
>
> ⚠️ **`restoreDrillStatusSource` 必須化の後方互換コスト（実測）**
> 生成側の書き込みを1行削除する mutation を当てると、追加した2件だけでなく**既存の end-to-end テスト2件**（`creates non-secret evidence from a pg_dump artifact file that passes the freshness gate` / `records an explicitly declared successful drill and passes the gate`）も落ちる。これは想定どおりで、**本変更以前に生成された証跡 JSON はこのゲートを通らない**ことの測定値である。影響が限定されるのは、証跡 JSON をリポジトリへコミットしておらず、生成と検査が同一ジョブ内で走るため。実害の範囲は「保管済み artifact」と「外部へ複製された写し」だけであり、いずれも再生成で解消する。
> なお `lastPgDumpStatusSource` は**必須にしていない**（非対称）。同フィールドには「生成側が既に fail-closed なのでここで落とすと手書き JSON しか捕まえられない」という判断が `check-neon-backup-evidence.js:247-250` に明記されており、これを覆すのは別変更として扱うべきだからである。`restoreDrillStatusSource` にその非対称が当てはまらないのは、訓練成否には fail-closed な実測経路が存在せず、供給元の記録だけが唯一の裏付けになるため。

### 2.2 `.github/workflows/ci.yml` job `production-target-env`（L157-222）

この job は `vars.CODIP_*` を8個の readiness check へ流し込む。T-Q2 と同型の構造が**最も密集している箇所**である。

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 7 | Monitoring evidence 7項目（`Cloudflare Access evidence recorded` ほか。`production-evidence-report.js:424-430`、判定関数は `:283-304`） | `ci.yml:184-190` の `vars.CODIP_CLOUDFLARE_ACCESS_EVIDENCE` / `CODIP_MONITORING_CONTACTS` / `CODIP_CLOUDFLARE_ALERT_POLICY` / `CODIP_CLOUDFLARE_LOGS_EVIDENCE` / `CODIP_NEON_MONITORING_EVIDENCE` / `CODIP_SMOKE_MONITORING_SCHEDULE` / `CODIP_ROLLBACK_OWNER` → `production-evidence-report.js:44-52` | 🔴 | 🗓️ **2026-08-11（QA 調査時点）の所見**: `evidenceState()` は「空でない」かつ「placeholder 正規表現に一致しない」だけを見る。**GitHub Variables に `ok` の2文字を入れれば7項目すべてが ✅ になる。** アラートポリシーが存在しなくても、監視連絡先が失効していても通る。→ この経路は **Issue #128 で閉じた**（現況は §2.5 S7 が実行検査する） | **是正済み（Issue #128）。** `EVIDENCE_FORMATS`（`:137-219`）で変数ごとに形を固定し、`evidenceFormatState()`（`:283-304`）だけが ✅ を出せる（書式仕様の無い鍵は fail-close で拒否する。`:293`）。ISO 8601 日付・cron 式・連絡先ハンドル・空白なし識別子など、**人間が場当たりに書けない形**を要求する。分類は 🔴 のまま（供給元は `vars.*` のままで、形式が正しい嘘は依然書ける）。API での存在確認は #9 / #10 と同じく Cloudflare 読取権限が要るため未着手 |
| 8 | `Backup/restore evidence recorded`（`production-evidence-report.js:431`） | `ci.yml:191` `vars.CODIP_BACKUP_RESTORE_EVIDENCE` → `production-evidence-report.js:54-56` | 🔴 | 🗓️ **2026-08-11（QA 調査時点）の所見**: #7 と同じ。§2.1 の Neon 側ゲートとは独立しており、こちらは文字列の非空判定のみ。→ **Issue #128 で閉じた**（現況は §2.5 S8） | **是正済み（Issue #128）。** PITR window + 訓練日（ISO 8601）+ 訓練結果（`DRILL_OUTCOMES` のいずれか）を要求する（`:196-218`）。残る課題は供給元の一本化で、`release:check-neon-backup-evidence` の判定結果を供給元にする案は未着手（証跡変数の二重管理が残っている） |
| 9 | `CODIP_NEON_BRANCH` / `CODIP_HYPERDRIVE_BINDING` 必須・非 placeholder（`validate-production-target-env.js:106-110`） | `ci.yml:176-177` の `vars.*` | 🔴 | 実際のデプロイ先と異なる branch 名・binding 名でも、placeholder 語（`:6-14`）を含まなければ通る。誤った Neon branch を指したまま production 判定が成立する | `wrangler.jsonc` の `hyperdrive[].binding` および Neon API の branch 一覧と突合する |
| 10 | `CODIP_DISABLE_TOKEN_AUTH=true` / `CODIP_TRUST_PROXY_AUTH=true`（`validate-production-target-env.js:121-127`） | `ci.yml:179-180` の `vars.*` | 🔴 | **認証方式の宣言と実際のデプロイ設定が乖離しても検知しない。** Variables が `true` でも、デプロイ済み Worker の実効設定が異なれば直接トークン認証が生きたまま通る | デプロイ後の実挙動で確認する（未認証リクエストが Access へリダイレクトされることを smoke で確認済み。その結果を判定に接続する） |
| 11 | `DATABASE_URL` / `CODIP_MIGRATION_DATABASE_URL` の形式（postgres・sslmode・非 localhost。`validate-production-target-env.js:42-67, 90-91`） | `ci.yml:171-172` の `secrets.*` | 🔴 | 形式のみの検査で**接続は行わない**。到達不能・権限不足の URL でもこのゲートは通る | 緩和要因あり: 同 job の `db:pg:check-drift`（#14）が同じ `DATABASE_URL` で実接続するため、後段で失敗する。ゲート名を「形式契約」と明示すれば足りる |
| 12 | `CODIP_BASE_URL` が production ホストと一致（`validate-production-target-env.js:93-104`、定数は `:15`） | `ci.yml:175` の `vars.CODIP_BASE_URL` だが、`:99-101` で `odip.mirai-dx-platform.com` に**ピン留め**されている | 🟢 | — | **良い型の実例。** 自己申告の値でも、期待値をコード側の定数に固定すれば実質的に改竄余地が消える。#9 もこの形に寄せられる |
| 13 | `production-placeholders`（routes / workers_dev / CODIP_BASE_URL。`check-production-placeholders.js:64-87`） | `check-production-placeholders.js:26-30` が `wrangler.jsonc` を読む | 🟢 | — | ⚠️ **検査対象のズレ**: 検査対象は「リポジトリの宣言」であって「デプロイ済み Worker の実設定」ではない。Dashboard 側で route を変更されても検知しない。文書側に明記する |
| 14 | PostgreSQL migration drift（`db:pg:check-drift`） | `check-postgresql-migration-drift.js:5` `process.env.DATABASE_URL` → `:12` `spawnSync` で Prisma を実 DB へ実行 | 🟢 | — | 現状維持。**本 job で最も強い実測** |
| 15 | PostGIS DDL 検査（`db:pg:check-postgis-ddl`、`ci.yml:219`） | `check-postgis-standard-record-ddl.js`（自前の I/O を持たず、呼び出し側の Prisma 接続経由） | 🟢 | — | 現状維持 |
| 16 | production smoke（`ci.yml:225,229`） | `release-smoke.js:27` `fetch(url, …)`、対象は `:119` `--base-url`（#12 でピン留め済み） | 🟢 | ⚠️ **供給元は実測でも判定が弱い例**（§1.1 の一種）。QA 調査時点の CSP 判定は部分文字列照合で、`connect-src` を丸ごと削除しても `img-src` 側の同一オリジン出現だけで条件が成立し、許可元の追加も検知しなかった。→ **Issue #129 で閉じた**（現況は §2.5 S16） | **是正済み（Issue #129）。** `scripts/tools/csp-contract.js` の `PINNED_DIRECTIVES` と突合し、ディレクティブの増減・許可元の増減・report-only の追加・ヘッダ重複を検知する。期待値は E2E と共有の単一定義で、本番構成へピン留めする。**供給元が 🟢 実測でも判定は別途検算が要る**ことの実例 |
| 17 | Cloudflare build artifact（`ci.yml:213` → `:216`） | `check-cloudflare-build-artifact.js:18-26` が `.open-next/` の実ファイルを `existsSync`/`statSync` | 🟡 | 同一 job の `npm run cf:build` が生成した成果物を同一 job が検査する。**本番へデプロイされた成果物とは独立**。ビルドは通るがデプロイが古いままでも検知しない | デプロイ後に `wrangler deployments list` の結果と突合する（現状は release notes への手貼り運用。レポート側は `inspectWrangler()` が `wrangler.jsonc` の**設定**を読むだけで、実デプロイとは突合していない） |

> 🔍 **本監査が見落としていた第二の供給経路（本表では採番していない）**
> #7 / #8 の供給元を `ci.yml` の `vars.*` に限って追跡したため、**同じ変数を `scripts/deploy/deploy-production.mjs` が自分で埋めていた**経路を記録できていなかった。旧実装は 8 変数それぞれにスクリプト内リテラルの既定値を持ち、未設定でも証跡報告に ✅ が並んだ。`CODIP_CLOUDFLARE_ACCESS_EVIDENCE` の既定値は「Cloudflare Access未設定」と述べる文字列でありながら、それを受け取るゲートは ✅ を出していた。§1 の方法論では**スクリプト内リテラル = 🔴**（#20 と同型）であり、しかも監査対象が自分で証跡を書いていた点で #2 / #3 の調査時点の構造と同じである。
> **是正済み（T-B7）。** 既定値を全廃し、未設定なら deploy を止める（`deploy-production.mjs` の `resolveEvidenceEnv()`）。ゲートは Neon 読取や DNS レコード作成より**前**に置き、証跡を出せない deploy が遠隔状態を半分だけ変えて止まることを防ぐ。`CODIP_NEON_BRANCH` だけは必須変数にせず、Neon API から取得済みの実測値を使う（機械が既に知っている事実を人間に入力させ、その入力を監査する形は自己申告を増やすだけである）。現況は §2.5 SB7 が実行検査する。**ゲートが正しいことと、ゲートが呼ばれていることは別の主張である。** `resolveEvidenceEnv()` の fail-closed だけを測るテストは、呼び出し側からゲート行が外れても緑のまま通る（実測済み）。そのため `tests/unit/deploy-production-evidence.test.ts` は `main()` を実際に走らせ、証跡変数が無いとき遠隔読取にも子プロセスにも到達する前に停止することを測る。この結線検査が測っていない範囲は §2.5 SB12 に記録する。
> 正式な採番と再監査は QA の判断とする（§4 参照）。

### 2.3 `.github/workflows/ci.yml` job `release-gate` / 契約検査群

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 18 | 依存監査（本番グラフ、`ci.yml:58`） | `npm audit --audit-level=moderate --omit=dev`（レジストリ実測） | 🟢 | — | 現状維持 |
| 19 | 依存監査（全グラフ + allowlist、`ci.yml:65`） | `check-dependency-audit.js:115` `spawnSync("npm", ["audit","--json"])` | 🟢 | ⚠️ ただし `:21-32` の `ALLOWLIST` は人間の自己申告による抑止。`:131` の `--input` で保存済みレポートを評価する経路も存在する（CI では未使用） | **良い型の実例。** allowlist に `expires` / `owner` / `tracking` を必須化しており、自己申告に**時限**が付いている。`--input` は test 専用である旨をコメントで明示済み（`:11-12`） |
| 20 | production env 契約（synthetic） | `release-gate.js:63-70` がスクリプト内リテラルの `DATABASE_URL`（`example.com`）・`CODIP_ADMIN_TOKEN` を渡す。CI 版は `ci.yml:120-125` | 🔴 | **本番の env が壊れていてもこのゲートは通る。** 検査しているのは validator の挙動であって production の状態ではない | 是正不要だが名称の明確化を推奨。`release-gate.js:63` は既に `(synthetic)` と自己申告しており誠実。CI 側も同様に自己申告済み: ステップ名 `ci.yml:119` が `(synthetic values)` を含み、`:112-118` のコメントが「緑でも production の証跡ではない」ことを明示する（注記は 7f72626 で追加済みであり、当初指摘した欠落は解消している） |
| 21 | SQLite 前提の DB ゲート群（`db:migrate` / `db:check-duplicates` / `db:check-standard-record-policy` / `db:prune --dry-run`。`ci.yml:99-104`、`release-gate.js:27,30-48`） | `DATABASE_URL: file:./dev.db`（`release-gate.js:27`）。`check-standard-record-policy.js:18-32` が SQLite を実クエリ | 🟡 | 同一 run で作った使い捨て SQLite を検査している。**本番 PostgreSQL のデータ状態は一切見ていない。** 例えば本番の重複 `officialUrl` は検知されない | 分類は 🟡 で妥当。ゲート名から「本番データの検査」と誤読されないよう文書側で区別する |
| 22 | ドキュメント/API 契約検査群（`release:check-v1-contract` / `check-doc-api-contract` / `check-openapi-coverage` / `check-docker-contract` / `check-audit-contract` / `check-cloudflare-contract`。`ci.yml:80-87`） | いずれもリポジトリ内ファイルの実読み込み。例: `check-cloudflare-neon-contract.js:7-22`（`.env.example`・4 runbook・`wrangler.jsonc`・`src/lib/db.ts`・`schema.prisma` など13ファイル）、`check-audit-contract.js:17-20` | 🟡 | **群の最弱に合わせた分類（Issue #134）。** `check-audit-contract.js:55` は ADR 0002 の振る舞いの主張（監査INSERT失敗時の応答コード）を `src/lib/audit-events-client.ts` のコメント文字列の存在だけで検査するため、`src/app/api/admin/audit-events/route.ts:65` の status を書き換えても緑のまま通る（他5件は 🟢 相当） | ⚠️ **検査対象のズレ**: 「文書と実装の整合」を検査しており、実装が正しいことは保証しない。設計どおりの役割だが、**振る舞いの主張はコメント照合では守れない**。→ **是正済み（Issue #134）**: 失敗系の実測を `tests/unit/audit-transaction-routes.test.ts` に追加した（503 応答と、監査INSERT失敗時に業務側書き込みを commit しないこと）。ゲート自体の分類は 🟡 のまま（供給元はコメントのままで、テストは別経路の担保である） |
| 23 | GitHub Actions 契約（`check-github-actions-contract.js:8`） | workflow YAML の実読み込み（`readFileSync`） | 🟢 | — | ⚠️ **検査対象のズレ**: YAML の記述内容を検査するが、その job が実際に実行・成功したかは見ない |
| 24 | preview smoke（`ci.yml:128-143`） | `release-smoke.js:27` の `fetch` だが対象は同一 job で起動した `127.0.0.1:3100`（`ci.yml:134`） | 🟡 | 同一 run で起動した preview サーバを検査している。本番の挙動とは独立 | 分類どおり。#16（本番 smoke）と併存しているため実害は小さい |

### 2.4 `.github/workflows/production-smoke.yml`

| # | ゲート名（検査項目） | 供給元（ファイル:行） | 分類 | 偽陰性シナリオ | 是正案 |
| ---: | --- | --- | :---: | --- | --- |
| 25 | production readiness（`production-smoke.yml` の `production-status` step → `Enforce production readiness`） | `post-release-status.js:383` `probeUrl(args.productionUrl, PRODUCTION_PATHS)` の実 HTTP。既定 URL は `:5` の定数、対象パスは `:11` | 🟢 | — | **自己申告入力を持たない唯一のゲート。** `CODIP_PRODUCTION_URL` で上書き可能だが workflow は渡していない（`production-smoke.yml` の env は Access 用 secret 2件のみ） |
| 26 | 「連続2回以上の失敗で P1」の評価 | 供給元となる実装が存在しない。run 間の状態を保持しないことは `tests/unit/monitoring-runbook-contract.test.ts:111-117` で固定済み | 🔴 | **人間の記憶が唯一の供給元。** 前回 run の結果を機械が保持しないため、2回連続失敗しても自動では P1 と判定されない | backend への変更仕様は monitoring.md §1.1.4 に記載済み（T-B3） |

### 2.5 偽陰性シナリオの現況（実行検査される）

本監査は「ゲートが自己申告に依存している」ことを指摘した文書である。その文書自身が**自分の正しさを自己申告している**なら、指摘した欠陥をそのまま踏んでいる。上の各行の「偽陰性シナリオ」は調査時点の観測であり、是正が入れば黙って偽になる。実際 §2.2 #7 は Issue #128 の是正で偽になったが、文書は当時のまま残っていた。

そこで、**文書が「こうすれば通ってしまう」と書いた操作を実コードに対して実行し**、その結果と下表の現況を `tests/unit/evidence-gate-audit-scenarios.test.ts` が突き合わせる。食い違えば CI が落ちる。方向は両方向で、解消済みと書いた欠陥が再現しても、未解消と書いた欠陥が既に再現しなくても落ちる（後者は「是正したのに文書を直していない」＝今回と同じ陳腐化である）。

この検査は**代理指標を置かない**。隣接する `tests/unit/evidence-gate-audit-contract.test.ts`（QA 所有）は #7 の緩さを「`evidenceState` の本体に外部呼び出しが現れるか」で近似しているが、#128 は外部呼び出しを増やさず形式検査を足す是正だったため、代理指標は動かないまま文書の主張だけが偽になった。**代理指標は「是正の形」を先読みしている点で、いつか必ず外れる。** 本節は是正の実装方法に依存しない。

責務の境界は次のとおり。各ゲートが正しく動くことの証明は各 Issue のテスト（`production-evidence-report.test.ts` / `release-smoke-csp.test.ts` / `deploy-production-evidence.test.ts`）が負う。本節が負うのは、**この監査記録が実態と一致していること**だけである。

検証欄: 🔬 実行検査（実コードを動かして確認する）／📣 宣言（実行しておらず、根拠は下記の記述のみ）
現況欄: 🔓 再現する（偽陰性は今も成立）／🔒 解消済み

| ID | 監査上の主張 | 検証 | 現況 | 実行/未実行の内容 |
| --- | --- | :---: | :---: | --- |
| S1 | #1 PITR retention をリテラルではなく Neon API 実測から書く | 📣 | 🔒 | 未実行: 再現には Neon control-plane の読取キーが要る。テストへ実キーを置かず、モックで代替すると「モックが返した値をモックで検算する」循環になり、この節が塞ごうとしている自己申告そのものになる。判定は Issue #126 のテストに委ねる |
| S3 | #3 pg_dump の success 判定を artifact の実在から導く | 📣 | 🔒 | 未実行: 再現には実際の dump artifact と `fs.statSync` が見るファイルの実体が要る。空ファイルを置いて通ることを示す形は可能だが、Issue #127 のテストが同じ検査を artifact 側で行っており重複する |
| S7 | #7 GitHub Variables に `ok` の2文字を入れれば monitoring evidence 7項目すべてが ✅ になる | 🔬 | 🔒 | 7変数それぞれに2文字の値を渡し、`evidenceFormatState()` が ✅ を返さないことを確認する。1つでも受理すれば欠陥は残っているとみなす（文書の文言は「すべてが ✅」だが、判定はより厳しい側を採る） |
| S8 | #8 backup/restore evidence も同じく非空判定のみで通る | 🔬 | 🔒 | `CODIP_BACKUP_RESTORE_EVIDENCE` に2文字を渡して同上 |
| S9 | #9 Cloudflare Access の設定有無を検査せず、変数の存在だけで通る | 📣 | 🔓 | 未実行: `validate-production-target-env.js` は `module.exports` を持たず読込時に `main()` が走る。子プロセスでの再現には proxy secret を含む production 相当の env 一式が要り、テストへ秘密相当のリテラルを置くことになる（gitleaks 検知対象）。§4 の残課題として追跡する |
| S10 | #10 DNS/route の実在を検査せず、宣言値の一致だけで通る | 📣 | 🔓 | 未実行: S9 と同一スクリプト・同一理由。Cloudflare API 読取権限も併せて必要 |
| S11 | #11 Worker のデプロイ実体を検査せず、`wrangler.jsonc` の記述で通る | 📣 | 🔓 | 未実行: S9 と同一スクリプト・同一理由。実体確認には Workers API 読取権限が要る |
| S16 | #16 本番 smoke の CSP 判定は部分文字列照合で、`connect-src` を丸ごと削除しても通る | 🔬 | 🔒 | 契約準拠 CSP から `connect-src` を除いたヘッダを `requireCspContract()` に与え、不合格になることを確認する。併せて**契約準拠 CSP が合格すること**も確認する（基準がずれて全部落ちている状態を「検知できた」と読み違えないための対照） |
| S22 | #22 `check-audit-contract.js` は ADR 0002 の**振る舞いの主張**をコメント文字列の存在だけで見るため、監査INSERT失敗時の応答を 503 から 200 へ落としてもゲートは通る | 🔬 | 🔓 | `route.ts` だけを改変した木を組み、`check-audit-contract.js` を**そのまま子プロセスで実行**して exit 0 になることを確認する。ゲートの needle 一覧はテストへ写経しない（写経すれば代理指標になる）。併せて**未改変なら通ること**も確認する（砂場の組み立て失敗を「検知できた」と読み違えないための対照）。現況が 🔓 なのは、Issue #134 の是正が**ゲート側ではなく別経路のテスト**（`tests/unit/audit-transaction-routes.test.ts` の失敗系）だからである |
| SB7 | 採番外（§2.2 の注記）: deploy スクリプトが証跡値を自分で供給していた | 🔬 | 🔒 | env を空にして `resolveEvidenceEnv()` を呼び、例外で停止することを確認する。旧実装は8変数すべてを既定値で埋めて deploy を続行していた |
| SB12 | 採番外: SB7 のゲートが deploy 経路に結線されていること（`main()` から呼ばれ、遠隔状態に触れる前に効くこと） | 📣 | 🔓 | 未実行: 結線そのものは `tests/unit/deploy-production-evidence.test.ts` が `main()` を走らせて実測するが、**ここに宣言として残すのは、その実測が届かない範囲である。** 観測点は `fetch` と `spawnSync` の2経路だけで、ゲートより前に置かれた別種の副作用（ファイル書き込みなど）は観測点を持たないため、順序が逆転しても落ちない。また `--skip-deploy` は argv 由来の module 定数のため、測っているのは skipDeploy=false の経路だけである。観測点を網羅するには `main()` の副作用を注入可能な形へ分解する必要があり、今回はそこまで行っていない。副作用の種類が増えたら観測点を足すこと（同旨をテスト側のコメントにも残した） |
| SB139 | 採番外（§2 の対象外だったゲート）: `.github/workflows/codeql.yml` の security scan は、`upload: never` の下で **analyze が落ちるのはアナライザ自身の失敗時だけ**で、検出結果では落ちない。SARIF は誰も読まない14日間の artifact に落ちるだけであり、このジョブの緑は「スキャンが走った」ことしか示さない（等級3 / 内容非検証） | 🔬 | 🔓 | 実行した: 実際の CodeQL 出力（run 31541261002 / commit `9ea42d5` の `codeql-sarif` artifact）を `check-codeql-sarif.js` に与え、high 6 件で exit 1 になることを確認した。併せて **検出 0 件の SARIF が exit 0 になること**も確認する（無条件に赤いゲートは赤いことが何も意味しないため）。閾値は `security-severity >= 7.0` であって `level` ではない — 実測ではその6件すべてが **実効 level `warning`** かつ `security-severity: 7.8` であり、`level === "error"` を閾値にすると high 6 件を抱えたまま緑になる。ここは実フィールドと実効値を分けて記録する必要がある: run `31555165656` の artifact `9125778552` を実測すると、**6件とも `result.level` 自体が欠落**しており、`warning` は `rule.defaultConfiguration.level` から来た値である（同 SARIF の rule 87 件中 2 件は `defaultConfiguration.level` も持たない）。「`level` が `warning` だった」とだけ書くと、値が入っていたのか欠落の既定値なのかが再現できない。**欠落と値を同じ記述へ潰すことは、本行が摘発している欠陥と同型である。**fixture は実出力の構造（`results[]` に `level` が無い／`driver.rules` が空／rule は `tool.extensions[].rules`）を写している。テストは `tests/unit/codeql-sarif-gate.test.ts`。**現況が 🔓 なのは、判定を置いた `codeql-findings` が branch protection の必須チェックではないためである。** 必須チェックは `analyze` のままで、そちらは high を抱えたまま緑になれる。したがって「必須チェックが緑＝high 脆弱性ゼロ」と読む経路の偽陰性は今も成立する。必須化は保護規則の変更（§17）であり人間の決裁を要する。条件と残り6件は `docs/adr/0003-codeql-upload-platform-limitation.md` に記載し、Issue #142 で追跡する。**抑制チャネルにも同じ形の穴があった**: 追加時点の判定スクリプトは `result.suppressions` を一度も参照しておらず、抑制された検出は通常の検出と同じに扱われるだけで、「何が誰の判断で免除されたのか」は CI のどこにも現れなかった。抑制を塞いだのではなく見えない場所へ移した状態である。2026-08-12 に受理条件（`kind: "external"` かつ理由が非空）・受理件数の常時出力・予算 0 を実装し、`tests/unit/codeql-sarif-gate.test.ts` の 13 ケースで実測した（理由なし／形が不正／`inSource`／予算超過はいずれも exit 1、受理件数は合格・不合格のどちらでも出力される）。ゲートは理由の**中身**を判定しない。中身の要件（受容者・受容日・owner・期限・受容したリスク）は ADR 0003 の「受容記録」に置き、個別抑制・予算引き上げ・**ゲート自体を必須にしないこと**の 3 つへ同じ 5 項目を適用する。**同じ形の穴が 3 本目、閾値判定そのものにあった**（2026-08-12 / CodeRabbit 指摘）: `security-severity` の検査が `!Number.isFinite(Number(raw))` だけだったため、`""` / `null` / `false` / `[]` はいずれも `Number()` が `0` を返して有限値と判定され、**severity 0 として黙って合格していた**。実測で 6 種の不正値のうち 4 種が exit 0、`42`（範囲外）は exit 1 になるものの *finding* として重大度 42 の検出に化けていた。修正後は 6 種すべてが structural problem として exit 1 になり、正当な `"0"` / `0` は合格し続ける（「重大度が明示されているが読めない」と「重大度が無い」を区別する）。変異試験 3 種（素朴な検査へ差し戻し／範囲検査の削除／空文字列検査の削除）で 8 / 2 / 2 件が落ちることを確認した。**同じ形の穴が 4 本目、同じ判定のもう一方の入口にあった**（2026-08-12）: `security-severity` は上記のとおり厳格に検証される一方、`level` は `result.level ?? rule.defaultConfiguration?.level ?? "warning"` と書かれており、**一度も検証されていなかった**。`??` は明示された `null` を欠落へ潰すため、産出器が `null` を書いた場合・語彙外の値（`"fatall"` のような綴り誤り）・文字列以外の型のいずれもが `warning` へ落ち、`FAILING_LEVELS` による失敗判定が黙って消える。**同じ判定の入口ごとに強度が違うこと自体が欠陥であり、弱いほうの入口が実効的な強度を決める。** 是正では `hasOwnProperty` で**真の欠落**だけを既定へ落とし、読めない値は次の供給元へ流さず structural problem にした（流すと「読めない」が「不在」として既定へ再合流し、塞いだ穴がそのまま開く）。受理語彙は CodeQL が実際に出す `note` / `warning` / `error` の 3 語に固定した（SARIF 2.1.0 の enum には `none` もあるが、産出器が出さない語まで受理を広げない）。実データでの変異試験: 上記実 SARIF から `security-severity` を除去して `level` だけが判定を決める形にし、`error` / `fatall` / `null` / object の 4 変異を与えたところ、旧実装は exit 1 / 0 / 0 / 0、新実装は 1 / 1 / 1 / 1 だった。**厳格化しても実データの structural problem は 0 件のまま**（同 artifact で `FAIL: 6 finding(s) …, 0 structural problem(s)`）であることを push 前に実測している — `level` の欠落は本番で**正常な多数派**であり、欠落を構造異常にする実装は実データで落ちて無効化されるからである |

> 📌 **是正済みと書いたら、ここに行を足すこと。** §2 のゲート行で是正案セルに「是正済み」と書かれたものは、本節に対応行を持つことをテストが強制する。文言だけ直して監査記録の見た目を整える経路を塞ぐための規則であり、実行検査が難しければ 📣 宣言として理由を書けばよい。**要件は「実測か宣言か」が読み手に伝わることであって、全項目を実行検査することではない。**

---

## 📌 3. 横断的な所見

### 3.1 自己申告が集中する場所

🔴 10件の供給元別内訳:

| 供給元 | 件数 | 該当 |
| --- | ---: | --- |
| GitHub Variables（`vars.*`） | 4 | #7（7変数を束ねた1行）・#8・#9・#10 |
| `workflow_dispatch` input または `vars.*` | 3 | #2・#4・#6 |
| スクリプト内リテラル | 1 | #20 |
| GitHub Secrets（形式のみ検査） | 1 | #11 |
| 供給元となる実装が存在しない | 1 | #26 |

いずれも「人間が値を決め、その値を機械が検査する」構造であり、監査証跡としては循環している。

> 🔁 T-B4 の是正で、#1 は `workflow_dispatch` input から、#3 はスクリプト内リテラルから、それぞれ 🟢 実測へ移った。#2 はスクリプト内リテラルから `workflow_dispatch` input / `vars.*` へ移動しており、**分類は 🔴 のままだが循環は切れている**（生成側が値を持たないため、無申告は緑ではなくジョブ失敗になる）。

### 3.2 重大度の順位（QA 判断）

| 順位 | 対象 | 理由 |
| ---: | --- | --- |
| 1 | #2 `restoreDrillStatus` | 調査時点では失敗し得ない構造だった。**復旧可能性という最も重い主張**を検証なしで肯定していた。Issue #127 で fail-closed 化したが、申告依存であることは変わらない |
| 2 | #4 `lastRestoreDrillAt` | 訓練の実施そのものを自己申告に依存。#2 と組み合わさると「訓練を一度もせずに常時グリーン」が成立していた（Issue #127 以降は無申告なら失敗するため成立しない） |
| 3 | #7 monitoring evidence 7項目 | 2文字の文字列で7つの readiness check が通る。障害検知体制の主張が空洞化する。**是正済み（Issue #128）** — 形式を固定し、2文字では通らない（§2.5 S7 が実行検査）。ただし供給元は `vars.*` のままで、**形式が正しい嘘は依然書ける**ため順位そのものは下げない |
| 4 | #1 `historyWindowHours` | Issue #126 で Neon API 実測へ是正済み。実測できない場合は証跡を書かずに失敗する |
| 5 | #10 認証方式の宣言 | 宣言と実効設定の乖離を検知しない。ただし Access 経由の実挙動は別途確認済み |

### 3.3 参考にすべき「良い型」

リポジトリ内に、自己申告を安全に扱う実装が既に2つある。是正はこれらに寄せるのが最小変更である。

1. **期待値のピン留め**（#12 / `validate-production-target-env.js:99-101`）— 値は `vars.*` 由来でも、期待値をコード内定数に固定すれば実行者は合格させられない
2. **時限付き allowlist**（#19 / `check-dependency-audit.js:21-32`）— 自己申告による抑止を許すが、`expires` / `owner` / `tracking` を必須にし、期限切れをゲート失敗として扱う

### 3.4 分類が 🟢 でも安心できない場合

項目 #13・#23（および Issue #134 で 🟡 へ移した #22）は供給元としては実測だが、検査対象がリポジトリ内の宣言である。「wrangler.jsonc が正しい」ことと「デプロイ済み Worker が正しい」ことは別の命題であり、前者から後者は導けない。現在この差を埋めているのは #16（本番 smoke）と #25（定期 smoke）のみである。

### 3.5 欠陥クラス: 0件・不一致・空配列を成功として扱わない

対象を集めてから検査するゲート（走査・抽出・パターン照合・観測点の差し替え）は、**「検査して問題が無かった」と「検査対象を1つも得られなかった」を同じ緑で表す**構造に落ちやすい。供給元の分類（§1.1）では見えない。供給元が実測でも、抽出が空振りすれば判定は無条件に通るためである。

不変条件: **抽出・走査の結果が空なら合格にしない。** 0件は「異常なし」ではなく「検査が成立しなかった」として失敗させる。観測に依存する検査は、観測点自体が生きていることを別途確認する（対照）。

この不変条件が効いている場所:

- `scripts/tools/check-github-actions-contract.js` — workflow から抽出した action 参照の集合
- `tests/unit/deploy-production-evidence.test.ts` — 「呼ばれていない」を主張する前に、差し替えた観測点が実際に効いていることを見る対照
- `tests/unit/evidence-gate-audit-scenarios.test.ts` — 改変した砂場が「落ちる」ことを主張する前に、未改変の砂場が通ることを見る対照（S16 / S22）

参照先が消えれば grep で分かる。新しいゲートを足すときは、まずこの不変条件に照らすこと。

---

## 📌 4. 残課題（本監査で実装しないもの）

| 項目 | 所有者候補 | 状態 |
| --- | --- | --- |
| #1 の是正（Neon API 実測） | backend | **完了**（Issue #126 / T-B4）。⚠️ 稼働には Neon control-plane の読み取り鍵登録が必要で、これは §17 の人間承認事項 |
| #2 / #3 の既定値 `"success"` 削除 | backend | **完了**（Issue #127 / T-B4）。#3 は artifact 実測へ、#2 は fail-closed な申告へ |
| #4 の訓練証跡連携 | backend + ReleaseManager | 記録様式は [`restore-drill-record.md`](../runbooks/restore-drill-record.md) として新設（Issue #127）。**訓練の実施そのものは未実施**（台帳の唯一の行が `not-run`）。run ID を機械的に供給する経路は未整備 |
| #7 / #8 の evidence 変数の形式限定 | backend | **完了**（Issue #128）。`EVIDENCE_FORMATS` で変数ごとに形を固定。現況は §2.5 S7 / S8 が実行検査する |
| #16 の CSP 判定を契約突合へ | backend | **完了**（Issue #129）。`csp-contract.js` の `PINNED_DIRECTIVES` と突合。現況は §2.5 S16 |
| deploy スクリプトの証跡既定値の全廃 | backend | **完了**（T-B7）。§2.2 の注記を参照。現況は §2.5 SB7。⚠️ 稼働には 8 変数の登録が必要で、未登録なら deploy は Neon 読取の前に停止する |
| #9 / #10 / #11 の実行検査（§2.5 の 📣 を 🔬 へ） | backend | 未着手。`validate-production-target-env.js` を import 可能な形へ分離しないと、再現に production 相当の env 一式（proxy secret を含む）が要る。テストへ秘密相当のリテラルを置かない方針を優先し、宣言のまま残している |
| 是正で追加された判定行の採番・再監査 | QA | 未着手。§2.1 の 🔍 注記に分類のみ記載。総数 26 を維持するため本表への追加は QA の判断に委ねる |
| #9 / #10 の実設定突合 | backend + Infra | 未着手。Cloudflare API 読取権限が必要 |
| #17 のデプロイ成果物突合 | Infra | 未着手 |
| 秘密混入検査の対象拡大（表外） | QA | 未着手。docs 配下の秘密混入を落とすのは `tests/unit/monitoring-runbook-contract.test.ts:290-313` のみで、対象は runbook 4ファイルに限定される。ゲートの供給元問題ではなくゲートの不在のため §2 の表には載せない |
| #26 連続失敗の機械評価 | backend | monitoring.md §1.1.4（T-B3）に仕様記載済み |

> ⚠️ 本監査は **read-only 調査**である。上記の是正はいずれも `scripts/**` および `.github/workflows/**` の変更を伴い、これらは backend 所有のため QA は編集しない。
> 🔁 本ファイルは QA 所有だが、Issue #127 に限り backend が §2.1 と連動箇所を更新した（§5.2 の設計どおり、是正と同じ変更単位に含めるため）。**所有権の移転ではなく**、QA のレビュー対象である。

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
# 是正後は neon-backup.yml:186 に --restore-drill-status がヒットする（= 供給経路が存在する）
grep -rn "restore-drill-status\|pg-dump-status" --include=*.yml --include=*.js . | grep -v node_modules

# 是正後の #3 の根拠: 生成側に status のリテラル既定値が残っていないこと（0件であること）
grep -nE '(pgDumpStatus|restoreDrillStatus):\s*"success"' scripts/tools/create-neon-backup-evidence.js
```

ドリフト検出テストは `tests/unit/evidence-gate-audit-contract.test.ts` に追加した。本ファイルの 🔴 / 🟡 行が供給元の根拠（`ファイル名:行番号`）を欠いた場合と、是正実装後に本ファイルの記述が古くなった場合に失敗する。

🔬 これに加えて、`tests/unit/evidence-gate-audit-scenarios.test.ts`（§2.5）が**文書の主張を実コードに対して実行して**検算する。両者の違いは次のとおりで、片方だけでは足りない。

| | `…-contract.test.ts`（QA 所有） | `…-scenarios.test.ts`（backend 所有 / §2.5） |
| --- | --- | --- |
| 見るもの | 文書の**構造**（分類記号・件数の整合・根拠引用の有無・秘密混入） | 文書の**主張の真偽**（偽陰性が今も再現するか） |
| 判定方法 | 実装ソースを正規表現で読む**代理指標** | 実装を import、またはゲートを子プロセスで**実行** |
| 強み | 実行できない主張にも効く。全行を機械的に走査できる | 是正の実装方法に依存しない。代理指標が先読みを外しても検知する |
| 弱み | 是正が代理指標の外側で行われると、緑のまま主張だけ偽になる（#128 で実際に起きた） | 実行可能な経路にしか置けない（§2.5 の 📣 行がその境界） |

> 📌 §2.5 の追加後も、`…-contract.test.ts` の #7 に関する代理指標（`evidenceState` 本体に外部呼び出しが現れるか）はそのまま残っている。この指標は Issue #128 の是正では動かず、現在も「外部呼び出しなし」を観測し続ける。**代理指標を実行検査へ置き換えるかどうかは QA の判断**であり、backend は当該ファイルを編集していない。

> 🔢 このテストの件数は固定ではない。引用検査が `it.each` で **🔴 / 🟡 行の数だけ動的に生成される**ため、分類が変われば総数も変わる。T-Q3（是正前・🔴 12 / 🟡 3）では 42件、T-B4 是正後（🔴 10 / 🟡 3）では 40件、Issue #134 の再評価後（🔴 10 / 🟡 4）では **41件**である。件数の変化そのものが分類状態のシグナルであり、減少は「🔴 が 🟢 へ移った」こと、増加は「🟢 が 🟡 以下へ移った」ことを意味する。**この数値は実行結果を書き写すこと**（推測で更新すると、件数そのものがまた自己申告になる）。

### 5.1 変異検査（テストが実際に何かを守っていることの確認）

本文書のテストは「通ること」ではなく「**壊れたときに落ちること**」で価値が決まるため、意図的な変異を入れて false に転じることを確認した。

| 変異 | 意図した検知対象 | 結果 |
| --- | --- | :---: |
| §0.1 に「失敗し得ない」旨の断定表現を復活させる（実装は是正済みのまま） | 是正済みなのに文書が未是正と読める状態 | ✅ 1件 fail |
| §0.1 の 🔴 件数を 10→9 に改竄 | 要約と実データの乖離 | ✅ 1件 fail |
| 🔴 行(#7)の供給元セルから行番号引用を全削除 | 根拠なき分類 | ✅ 1件 fail |
| 🟡 行(#17)の供給元セルから行番号引用を削除 | 同上（🟡 も対象であること） | ✅ 1件 fail |

> ⚠️ 「🔴 行の引用を**1つだけ**消す」変異では落ちない。同一セルに別の行番号引用が残るためであり、意図した挙動である（供給元セルに1つ以上の引用があることを要求している）。
>
> 🔁 3行目・4行目は T-Q3（是正前）の実行結果をそのまま引き継いでいる。1行目・2行目は是正によって変異の内容自体が反転したため、Issue #127 の作業時に**この表の記述どおりの変異を新たに作って再実行**した。観測結果は次のとおりで、いずれも変異ごとに 1件だけ落ち、変異を戻すと 40件全通に復帰した。
>
> - 1行目: `Tests 1 failed | 39 passed (40)` — `neon backup gate claims match the implementation` が `expected false to be true`
> - 2行目: `Tests 1 failed | 39 passed (40)` — `keeps the section 0.1 summary counts equal to the section 2 rows` が `expected ... to match /\|\s*🔴[^|]*\|\s*10\s*\|/`
>
> ⚠️ 1行目の変異内容を**この表へ原文のまま引用してはならない**。テストは本ファイル全体を対象に文字列一致を見るため、引用した瞬間に変異を入れたのと同じ状態になる。表の記述を言い換えているのは意図的である。

### 5.2 このテストは T-B4 完了時に落ちた（対応済み）

`create-neon-backup-evidence.js` の既定値 `"success"` が削除された時点で、「neon backup gate claims match the implementation」の2件が **意図的に失敗する**設計だった。これは欠陥ではなく、**本文書の §2.1 #2 / #3 を更新せよという信号**である。

実際に Issue #127 の実装直後、当該2件が `expected false to be true` で失敗した（`Tests 2 failed | 40 passed (42)`）。backend は同じ変更単位で本ファイルを更新し、**40件すべてが通る状態**（`Tests 40 passed (40)`）へ戻した。総数が 42 から 40 へ減っているのは欠陥ではなく、上記 🔢 のとおり 🔴 が2件 🟢 へ移った結果である。

**この節は「テストが予告どおり機能した」記録として残す**。今後この2件が再び落ちたときは、実装か文書のどちらかが片方だけ変わったことを意味する。

---

## 📌 6. Safety

- 🔐 本監査で秘密情報の値は一切参照・記録していない。`ci.yml` の `secrets.*` は**参照名のみ**を引用した
- 🔐 新たな秘密の混入は発見していない。`create-neon-backup-evidence.js:110,233,243` に証跡フィールドの秘密混入拒否があることを確認した
- 🔐 Issue #126 で追加した Neon control-plane 呼び出しは、鍵を**環境変数名**（`--neon-api-key-env`）でのみ受け取り、値・リクエスト・レスポンス本文をエラーメッセージへ出さない（`create-neon-backup-evidence.js:178,183,190`）。単体テストは Neon API をループバックのスタブへ差し替えており、実 API へ接続しない
- 🔒 設定変更・デプロイ・API 書き込みはいずれも**未実施**
