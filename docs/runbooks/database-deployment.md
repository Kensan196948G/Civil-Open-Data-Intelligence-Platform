# データベースデプロイRunbook

CODIPのMVPはSQLiteで開発しているが、本番スケール時はPostgreSQL/PostGISへ移行する。SQLiteは共有プレビューの単一インスタンス検証に限定する。

> ⚠️ 本番は2026-08-30にNeon（クラウド管理PostgreSQL）からこの開発機のローカルPostgreSQLへ移行済み。以降「本番PostgreSQL」はローカルインスタンスを指す。詳細は §4.1、[docs/runbooks/cloudflare-production.md](cloudflare-production.md) を参照。

## 1. 現在のDB方針

| 環境 | DB | 判断 |
| --- | --- | --- |
| Local | SQLite | 開発効率を優先して許可 |
| Preview | SQLite on Docker volume | 関係者検証に限定して許可 |
| Production | PostgreSQL/PostGIS | 必須。SQLiteは禁止。外部DBでは `sslmode=require` または `sslmode=verify-full` を指定 |

`npm run release:validate-env:production` は `DATABASE_URL=file:` を拒否し、外部PostgreSQLホストでは `sslmode=require` または `sslmode=verify-full` がない接続文字列も拒否する。PreviewでSQLiteを使う場合も `CODIP_ACCEPT_SQLITE_PREVIEW=true` を明示する。アプリ実行時は `DATABASE_URL` に応じてSQLite ClientまたはPostgreSQL Clientを選択する。

Docker imageの既定起動ではmigrationを実行しない。本番ではデプロイ前後のone-off release jobで `npx prisma migrate deploy --schema prisma/postgresql/schema.prisma` を実行し、アプリコンテナは `next start` のみにする。共有previewの単一インスタンス検証だけ `CODIP_RUN_MIGRATIONS_ON_START=true` を許可する。

## 2. SQLite Previewの運用制約

| 制約 | 内容 |
| --- | --- |
| 単一writer | 複数コンテナから同じDBを同時に更新しない |
| 水平スケール不可 | レプリカを増やす構成では使わない |
| Cloudflare Pages/Workers不可 | 通常のWorkers実行環境ではファイル永続化できない |
| バックアップ必須 | 共有プレビューでもデータ更新前にバックアップする |
| 復旧手順確認 | backupファイルからvolumeへ戻す手順を確認する |

## 3. SQLiteバックアップ

ローカルDB:

```bash
sh scripts/db/sqlite-backup.sh prisma/dev.db backups/sqlite
```

Docker preview volumeから取得する場合は、稼働コンテナ内の `/data/codip.db` を対象にする。

```bash
docker compose -f docker-compose.preview.yml exec codip sh scripts/db/sqlite-backup.sh /data/codip.db /data/backups
```

## 3.1 SQLite Preview復元

共有previewのSQLite復元は、単一インスタンス停止中に実施する。担当はリリース作業者、想定停止時間は5〜10分とする。

> ⚠️ バックアップファイル名は `scripts/db/sqlite-backup.sh` が `mktemp` で採番するため、
> `<元DB名>.<UTC時刻>.<ランダム6文字>` 形式になる (例: `dev.db.20260718T111650Z.fnyabJ`)。
> 固定名を決め打ちせず、下記のように**実ファイルを列挙して選ぶ**こと。

```bash
# 戻せるバックアップを新しい順に確認する
ls -1t backups/sqlite/
```

ローカルDBへ戻す場合:

```bash
# 0. 復元対象を変数に取る (上の ls で確認したファイル名)
BACKUP="backups/sqlite/<選んだファイル名>"

# 1. アプリを止める (稼働中に差し替えるとWALと本体が不整合になる)
docker compose -f docker-compose.preview.yml down 2>/dev/null || true

# 2. 現物を退避する
cp prisma/dev.db "prisma/dev.db.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"

# 3. ⚠️ 旧WAL/SHMを必ず削除する
#    sqlite3 ".backup" は単体完結のDBファイルを作るため、
#    古い -wal / -shm が残っていると復元後のDBが壊れる
rm -f prisma/dev.db-wal prisma/dev.db-shm

# 4. 復元して検証する
cp "$BACKUP" prisma/dev.db
DATABASE_URL='file:./dev.db' npm run release:validate-env:local
DATABASE_URL='file:./dev.db' npm run db:check-duplicates
```

Docker preview volumeへ戻す場合:

```bash
BACKUP_NAME="<backups/sqlite 配下から選んだファイル名>"

docker compose -f docker-compose.preview.yml down
docker run --rm \
  -v civil-open-data-intelligence-platform_codip-data:/data \
  -v "$PWD/backups/sqlite:/backup:ro" \
  -e BACKUP_NAME="$BACKUP_NAME" \
  alpine sh -lc 'cp /data/codip.db "/data/codip.db.before-restore.$(date -u +%Y%m%dT%H%M%SZ)" \
    && rm -f /data/codip.db-wal /data/codip.db-shm \
    && cp "/backup/$BACKUP_NAME" /data/codip.db'
docker compose -f docker-compose.preview.yml up -d
CODIP_ADMIN_TOKEN="$CODIP_ADMIN_TOKEN" npm run release:smoke -- --base-url http://127.0.0.1:3100
```

> 📎 切り戻し全体の判断フロー (コードのみ戻すか、DBも戻すか) は `docs/runbooks/rollback.md` §1 を参照。

復元後は `/api/ready`、`/sources`、`/logs`、管理セッション開始、代表データソース詳細を確認し、復元したbackup名と確認者をリリース証跡へ記録する。

## 4. PostgreSQL/PostGIS移行前チェック

| チェック | コマンド/確認 |
| --- | --- |
| 公式URL重複 | `npm run db:check-duplicates` |
| Prisma provider | `prisma/postgresql/schema.prisma` を検証 |
| PostGIS | `prisma/postgresql/migrations/20260713113000_init/migration.sql` に `CREATE EXTENSION postgis;` を含める |
| geometry | MVPのURL台帳から標準レコード/geometry表へ段階移行 |
| 接続方式 | Cloudflare Workersの場合はHyperdrive等の接続プールを検討 |
| 秘密情報 | `DATABASE_URL` はGitHub Secretsまたはデプロイ環境変数で管理 |

## 4.1 ローカルPostgreSQLバックアップ証跡

本番DBはローカルPostgreSQLへ移行済み（2026-08-30）。定期バックアップはローカルsystemdタイマー `codip-backup.timer`（日次03:17 JST）が `scripts/local-cron/run-backup.sh` を実行し、`pg_dump`（custom形式）をGPG AES256で暗号化して `~/backups/codip/` へ14日保持する。スクリプトは本番DB接続文字列とpassphraseを含むためリポジトリ非公開（`.gitignore` で除外）。旧GitHub Actions経路（`.github/workflows/neon-backup.yml`）はローカル移行のため削除された。

### 4.1.1 旧GitHub Actions定期pg_dump（2026-08-30廃止・記録）

`.github/workflows/neon-backup.yml` は毎日03:17 JSTに実行され、次を行っていた（Neon時代の記録）。

| 項目 | 内容 |
| --- | --- |
| Secret | `CODIP_NEON_PGDUMP_DATABASE_URL` と `CODIP_NEON_BACKUP_ENCRYPTION_PASSPHRASE`。専用dumpロールまたは最小権限URLを登録し、どちらもログではmaskする。加えてPITR実測用の `CODIP_NEON_API_KEY`（**project スコープの読み取り専用鍵を推奨**）が必要。⚠️ 本番Secretの追加はCLAUDE.md §17 のApproval対象であり、**2026-08-12時点で未登録** |
| Variables/Input | `CODIP_NEON_PROJECT_ID`、`CODIP_NEON_PGDUMP_HOST`（main branchの期待endpoint hostname）、`CODIP_NEON_HISTORY_WINDOW_HOURS`、`CODIP_LAST_RESTORE_DRILL_AT`、`CODIP_LAST_RESTORE_DRILL_STATUS`、`CODIP_LAST_RESTORE_DRILL_RECORD`、`CODIP_BACKUP_OWNER`。いずれも `Validate backup inputs` の必須リストに含まれ、**未設定なら合成既定値で通過せずジョブが失敗する**。証跡branchはworkflowで`main`に固定し、Secret URLのhostnameが期待値と不一致ならdump前にfail-closed |
| Artifact | custom format dumpをGPG AES256で暗号化した `codip-neon-pgdump-<UTC>.dump.gpg` を14日保持。復号Secretを持つ本番運用者に限定する |
| Evidence | `neon-backup-evidence` artifactを30日保持。Secretを含めず、PITR window、dump鮮度、restore drill鮮度を検査する |
| Fail closed | dump URL Secret未設定、暗号化Secret未設定、**restore drillの日時・判定・記録参照のいずれかが未記録**、**PITR保持期間を実測できない**、dump/暗号化失敗、証跡鮮度NGではworkflowを失敗させる |

初回運用時は `workflow_dispatch` で `restore_drill_at` / `restore_drill_status` / `restore_drill_record` を明示し、成功したActions run URLとartifact名をIssue #63へ記録する。Secretや接続文字列はIssue、README、ログへ貼らない。復旧訓練そのものの実施手順と記録台帳は [復旧訓練 実施記録](./restore-drill-record.md) にある。

```bash
# Neon control-plane の読み取り鍵は環境変数名で渡す。値を引数に書かない
export CODIP_NEON_API_KEY='<neon control-plane read key>'

npm run release:create-neon-backup-evidence -- \
  --project-id falling-dawn-93620497 \
  --branch main \
  --endpoint-host '<main-endpoint>.neon.tech' \
  --pg-dump-file /secure/artifacts/codip.dump \
  --restore-drill-at 2026-07-19T06:30:00Z \
  --restore-drill-status success \
  --restore-drill-record 'docs/runbooks/restore-drill-record.md#2026-07-19' \
  --owner release-manager \
  --pretty > evidence/neon-backup.json

npm run release:check-neon-backup-evidence
```

`release:create-neon-backup-evidence` はDBへ接続しない。dumpファイルの存在、サイズ、mtimeと、Neon control-plane から取得したPITR保持期間から非Secret JSONを生成する。dump内容は読まない。Secret-bearingな `pg_dump` 実行とartifact uploadは承認済みGitHub Actionsまたは運用端末で行い、生成されたJSONだけを `CODIP_NEON_BACKUP_EVIDENCE_JSON` または `--evidence-file` へ渡す。

> ⚠️ **Issue #126 / #127 による仕様変更（2026-08-11）。上の例から次のいずれかを外すと fail-closed で異常終了する。**
>
> | フラグ | 必須 | 未指定時の挙動 |
> | --- | :---: | --- |
> | `--restore-drill-status` | ✅ | 異常終了。**既定値 `success` は撤廃した**。語彙は `success` / `failed` / `partial` / `blocked` / `not-run` |
> | `--restore-drill-record` | ✅ | 異常終了。[復旧訓練記録](./restore-drill-record.md) への非Secret な参照を渡す |
> | `--pg-dump-status` | 条件付き | `--pg-dump-file` があれば**実測**するため不要。`--pg-dump-artifact` 経路では必須。実測と矛盾する値を渡した場合は**どちらも記録せず**異常終了 |
> | `CODIP_NEON_API_KEY`（環境変数） | ✅ | PITR保持期間を実測できず異常終了。**推定値へのフォールバックは無い**。変数名は `--neon-api-key-env` で変更できる |
> | `--history-window-hours` | ❌ | 任意。**ゲートの判定には使われず**、実測値とのドリフト検出用に `historyWindowHoursDeclared` として記録されるだけ |

最低限の証跡項目は `checkedAt`、`projectId`、`branch`、`historyRetentionSecondsMeasured`、`historyRetentionMeasuredAt`、`historyRetentionProjectId`、`historyRetentionSource`、`lastPgDumpAt`、`lastPgDumpStatus`、`lastPgDumpStatusSource`、`lastPgDumpArtifact`、`lastRestoreDrillAt`、`restoreDrillStatus`、`restoreDrillRecord`、`owner` とする。`lastPgDumpArtifact` はartifact名、保管先ID、または内部チケットIDに限定し、PostgreSQL URL、password、Neon API tokenを含めない。

既定ゲートは次の場合に失敗する。**PITR の判定に使うのは実測値 `historyRetentionSecondsMeasured` であり、運用者が申告した `historyWindowHours` ではない。**

- 実測PITR保持期間が24時間未満、実測値が欠落、実測時刻 `historyRetentionMeasuredAt` が24時間を超えて古い、または実測対象のproject idが `projectId` と不一致
- `pg_dump` が24時間を超えて古い
- restore drillが30日を超えて古い、または `restoreDrillStatus` が `success` 以外

## 5. 移行順序

1. SQLite previewで台帳・認証・監視APIを確認する。
2. PostgreSQL/PostGIS用Prisma schemaとmigrationを作成する。
3. 既存SQLiteデータをCSVまたはJSONでexportする。
4. PostgreSQLへimportし、`officialUrl` 一意制約と件数を確認する。
5. 初回staging deploy時に `/api/ready`、`/api/sources`、管理API、取得ログを確認し、証跡を `docs/runbooks/cloudflare-neon-staging.md` のEvidenceへ記録する。
6. Cloudflare Access、Hyperdrive、Neon接続を含むpost-deploy smokeをCI/CDへ追加する。

## 5.1 追加済みPostgreSQL資材

| 資材 | 内容 |
| --- | --- |
| `prisma/postgresql/schema.prisma` | PostgreSQL provider用schema。既存台帳モデルに加えて `StandardRecord` とPostGIS geometryを定義 |
| `prisma/postgresql/migrations/20260713113000_init/migration.sql` | PostgreSQL/PostGIS初期DDL |
| `prisma/seed-postgresql.ts` | PostgreSQL専用Prisma Clientで台帳seedと検証用 `standard_records` seedを投入するスクリプト |
| `npm run db:compare-schemas` | SQLite正本とPostgreSQL schemaの中核モデル存在確認 |
| `npm run db:pg:validate` | DB接続なしでPostgreSQL Prisma schema構文を検証 |
| `npm run db:pg:generate` | PostgreSQL専用Prisma Clientを生成 |
| `src/lib/db.ts` | `DATABASE_URL` が `postgresql://` または `postgres://` の場合、PostgreSQL専用Prisma Clientを使用 |
| `.github/workflows/ci.yml` | PostGIS service上でPostgreSQL migration、seed、runtime smokeを実行 |

注意: ローカル開発環境にPostgreSQL/PostGISがない場合、実DB runtime smokeはCIまたはPostGIS利用可能なstagingで確認する。production deploy前には、CIのPostgreSQL runtime smokeとstaging `/api/ready`、`/api/sources`、`/api/v1` standard_records mode、管理APIの確認を必須にする。

## 6. ロールバック

| 事象 | 戻し方 |
| --- | --- |
| migration失敗 | DB snapshotまたはSQLite backupへ戻す |
| import件数不一致 | importを停止し、export元と差分を確認 |
| API互換性破壊 | OpenAPI差分を確認し、該当リリースを止める |
| 空間検索不具合 | geometry変換履歴とSRIDを確認 |
