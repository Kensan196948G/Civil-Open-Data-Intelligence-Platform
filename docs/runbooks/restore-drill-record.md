# 🗄️ 復旧訓練 実施記録テンプレート

> 🗓️ 新設: 2026-08-11（Issue #127）｜ 種別: **非Secret の運用証跡様式** ｜ 関連: [DBデプロイ runbook](./database-deployment.md) / [通知テスト記録](./notification-test-record.md) / [証跡ゲート監査](../security/evidence-gate-audit.md) / [運用台帳](../operations/operations-ledger.md)

復旧訓練は「バックアップ取得ジョブが緑だったか」ではなく、**実際にリストアして中身を確認できたか**で合否を判定する。pg_dump が成功しただけでは、復元可能性の証拠にならない。

本ファイルは記録様式（§1）と記録台帳（§4）を兼ねる。台帳は追記のみとし、過去行を書き換えない。

> ⚠️ **なぜこのファイルが必要か**
> `.github/workflows/neon-backup.yml` の証跡ゲートは、復旧訓練の結果を**観測できない**。訓練は人間の手順であり、CI から見えるのは「誰かがそう言った」という申告だけである。以前はその申告が `create-neon-backup-evidence.js` の既定値 `"success"` として実装内に埋め込まれており、誰も上書きしないまま「復旧訓練は成功した」と監査証跡に記録され続けていた（Issue #127）。
> 現在は既定値を撤廃し、`--restore-drill-status` と `--restore-drill-record` の**両方が未指定ならジョブが失敗する**。申告そのものは避けられないが、申告には本ファイルの行番号・見出しという**追跡可能な裏付け**が必要になる。

---

## 1. 記録様式

復旧訓練1件につき、次の列をすべて埋める。**空欄・推測値のまま `success` としない。**

| 列 | 必須 | 記入内容 | 記入例 |
| --- | :---: | --- | --- |
| `実施日時 (UTC)` | ✅ | 訓練を開始した時刻。ISO 8601 | `2026-08-11T04:15:00Z` |
| `訓練種別` | ✅ | `pg_restore` / `neon-pitr-branch` / `neon-branch-reset` | `neon-pitr-branch` |
| `復元元` | ✅ | 復元に使った証跡の**非Secret 識別子** | `github-actions-artifact://codip-neon-pgdump-20260811T031700Z.dump.gpg` |
| `復元先` | ✅ | 復元先の環境と branch 名。**production への上書きは禁止** | `neon branch: drill-20260811（production から分岐）` |
| `検証クエリ` | ✅ | 復元後に何を確認したか。件数・スキーマ版など | `SELECT count(*) FROM data_sources` |
| `検証結果` | ✅ | 期待値と実測値の両方 | `期待 56 / 実測 56` |
| `所要時間` | ✅ | 復元開始→検証完了。RTO の実測値になる | `18分` |
| `データ欠損` | ✅ | RPO の実測値。最新コミットからの巻き戻り幅 | `0分` / `最大24時間` |
| `実施者` | ✅ | 実施した**人間**のロール名 | `ReleaseManager` / `DevOps当番` |
| `判定` | ✅ | `success` / `failed` / `partial` / `blocked` / `not-run` | `success` |
| `根拠` | ✅ | Actions run ID、Neon branch 名など**非Secret**の識別子 | `run 31456833751` |
| `次回実施予定` | ✅ | 四半期試験の次回目安 | `2026-11-11` |

### 1.1 記入禁止事項（Safety）

次を本ファイル・commit message・PR本文・ログへ**書かない**。

- ❌ Neon の connection string、`CODIP_NEON_PGDUMP_DATABASE_URL` の値、role のパスワード
- ❌ Neon / Cloudflare / GitHub の API token、バックアップ暗号化パスフレーズ
- ❌ 復元したデータそのもの（行の内容、個人情報、事業者名などのPII）

検証結果は**件数・スキーマ版・チェックサムなどの集計値**のみで表現する。「復元できた」を示すのに実データを引用しない。

### 1.2 判定基準

`create-neon-backup-evidence.js --restore-drill-status` が受け付ける語彙と一致させる。

| 判定 | 条件 | 証跡ゲートへの影響 |
| --- | --- | --- |
| `success` | 復元が完了し、**検証クエリの実測値が期待値と一致した** | ✅ ゲート通過 |
| `partial` | 復元は完了したが検証の一部が未実施・不一致 | ⚠️ ゲート不通過 |
| `failed` | 復元が失敗した、または検証で不整合を検出した | ⚠️ ゲート不通過 |
| `blocked` | 権限不足・環境未整備で訓練自体を実施できない | ⚠️ ゲート不通過 |
| `not-run` | 実施予定だが未実施。理由を `根拠` 列に記載する | ⚠️ ゲート不通過 |

`blocked` / `not-run` / `partial` を `success` へ繰り上げてはならない（Verification First）。**未実施を緑にするより、赤いバックアップジョブのほうが正しい状態である。**

---

## 2. 実施手順

1. `database-deployment.md` のバックアップ節を読み、対象 Neon project / branch を一意に特定する。
2. **復元先を用意する。** production branch へ直接復元しない。
   - `neon-pitr-branch`: production から時刻指定で新規 branch を作成する（読み取り専用の検証用）
   - `pg_restore`: 検証用 branch または隔離した検証用 DB へ復元する
3. 復元を実行する。暗号化 dump を使う場合はパスフレーズを環境変数で渡し、**コマンドラインに書かない**。
4. 検証クエリを実行し、期待値と実測値を控える。最低限、主要テーブルの件数と migration 適用状況を確認する。
5. 所要時間（RTO 実測）とデータ欠損幅（RPO 実測）を記録する。
6. **検証用 branch を削除する。** 放置すると課金対象かつ本番と紛らわしい。
7. §4 の台帳へ1行追記し、`docs/operations/operations-ledger.md` の運用記録へ相互参照を残す。
8. §3 の手順で証跡ゲートへ結果を反映する。

---

## 3. 証跡ゲートへの反映

台帳へ追記したら、復旧訓練の結果を運用台帳（`docs/operations/operations-ledger.md`）と日次確認へ反映する。旧GitHub Actions証跡ゲート（`neon-backup.yml` の `Validate backup inputs`）は2026-08-30にローカルsystemdタイマー移行で廃止された。ローカル移行後は `~/backups/codip/backup.log` の成功確認と、復元訓練の結果を本台帳へ記録する。

| 経路 | 設定先 | 用途 |
| --- | --- | --- |
| Repository Variables | `CODIP_LAST_RESTORE_DRILL_AT` / `CODIP_LAST_RESTORE_DRILL_STATUS` / `CODIP_LAST_RESTORE_DRILL_RECORD` | 日次スケジュール実行に反映する常設値 |
| `workflow_dispatch` inputs | `restore_drill_at` / `restore_drill_status` / `restore_drill_record` | 単発の再実行・確認 |

- `..._STATUS` には §1.2 の語彙のみを入れる。それ以外の文字列はツール側で拒否される。
- `..._RECORD` には**本ファイルへの非Secret な参照**を入れる。例: `docs/runbooks/restore-drill-record.md#2026-08-11`
- `..._AT` は §4 台帳の `実施日時 (UTC)` と一致させる。台帳に無い日時を書かない。

> 🔁 訓練が古くなると `lastRestoreDrillAt is fresh` ゲートが赤くなる。これは変数を書き換えて消す不具合ではなく、**次の訓練を実施せよという通知**である。

---

## 4. 記録台帳

| 実施日時 (UTC) | 訓練種別 | 復元元 | 復元先 | 検証クエリ | 検証結果 | 所要時間 | データ欠損 | 実施者 | 判定 | 根拠 | 次回実施予定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | - | - | - | - | `not-run` | 復旧訓練を実施した記録が存在しない。以前は `create-neon-backup-evidence.js` の既定値により `restoreDrillStatus: "success"` が自動的に記録されていたが、これは実施の証拠ではない（Issue #127）。本行は、その既定値を撤廃した時点での実態を明示するために置く | 初回訓練の実施後に本行の下へ追記する |
| 2026-08-11T22:15:01Z | neon-pitr-branch | PITR 2026-08-11T20:15:00Z（Neon project `falling-dawn-93620497` / main branch `br-solitary-breeze-afr5lrq4`） | 一時検証branch `br-blue-wave-afeh7gyq`（`restore-drill-20260812-20260811T221500Z`）※検証後に削除済み | `SELECT version()` / `PostGIS_Version()` / `count(*) FROM data_sources` / `count(*) FROM _prisma_migrations` / publicテーブル数 | 期待 62 / 実測 62（data_sources）。PG 17.10 / PostGIS 3.5 / migrations 6 / public_tables 23 | 約14分（22:15:01Z 作成→22:22:46Z データ利用可能→22:29Z 検証完了） | 復元点は作成の2時間前（選択した復元ポイント。障害時のRPO実測ではない） | CTO代行（human kensan の環境キー委任） | `success` | Neon API: branch/endpoint作成→psql検証→endpoint2本・branch削除（全てHTTP 200）。リポジトリ変数 `CODIP_LAST_RESTORE_DRILL_*` へ反映 | 2026-11-11 |

<!-- 新しい記録は上の表へ1行ずつ追記する。過去行は書き換えない。 -->

---

## 5. 四半期試験との関係

復旧訓練は四半期ごとに実施する。RTO / RPO の目標値と実測値の差は `docs/operations/operations-ledger.md` へ反映し、目標を満たせない場合は Issue 化する。

`docs/security/evidence-gate-audit.md` §2.1 は、本ファイルが存在しない状態の `restoreDrillStatus` ゲートを 🔴（自己申告）として分類している。本ファイルの追記によって申告に裏付けが付くが、**CI が訓練を観測できるようになるわけではない**。分類が 🔴 から動かないのは仕様である。
