# データベースデプロイRunbook

CODIPのMVPはSQLiteで開発しているが、本番スケール時はNeon PostgreSQL/PostGISへ移行する。SQLiteは共有プレビューの単一インスタンス検証に限定する。

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

ローカルDBへ戻す場合:

```bash
cp prisma/dev.db "prisma/dev.db.before-restore.$(date -u +%Y%m%dT%H%M%SZ)"
cp backups/sqlite/codip-YYYYMMDDTHHMMSSZ.db prisma/dev.db
DATABASE_URL='file:./dev.db' npm run release:validate-env:local
DATABASE_URL='file:./dev.db' npm run db:check-duplicates
```

Docker preview volumeへ戻す場合:

```bash
docker compose -f docker-compose.preview.yml down
docker run --rm \
  -v civil-open-data-intelligence-platform_codip-data:/data \
  -v "$PWD/backups/sqlite:/backup:ro" \
  alpine sh -lc 'cp /data/codip.db /data/codip.db.before-restore && cp /backup/codip-YYYYMMDDTHHMMSSZ.db /data/codip.db'
docker compose -f docker-compose.preview.yml up -d
CODIP_ADMIN_TOKEN="$CODIP_ADMIN_TOKEN" npm run release:smoke -- --base-url http://127.0.0.1:3100
```

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
