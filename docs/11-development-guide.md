# 開発ガイド

## 1. 前提

| 項目 | 内容 |
| --- | --- |
| ランタイム | Node.js |
| フレームワーク | Next.js 15, React 19, TypeScript |
| DB | SQLite / Prisma。PostgreSQL/PostGIS previewは別schemaとcomposeで検証 |
| テスト | Vitest, Playwright |

## 2. セットアップ

```bash
npm ci
cp .env.example .env
DATABASE_URL='file:./dev.db' npm run db:migrate
DATABASE_URL='file:./dev.db' npm run db:seed
DATABASE_URL='file:./dev.db' npm run dev
```

通常の開発URLは `http://localhost:3000`。管理操作をブラウザで試す場合は、32文字以上の `CODIP_ADMIN_TOKEN` を設定して起動し、`/settings` で管理セッションを開始する。

```bash
export CODIP_ADMIN_TOKEN="change-this-very-long-random-token-32"
DATABASE_URL='file:./dev.db' npm run dev
```

Docker previewの標準URLは、SQLite previewが `http://localhost:3100`、PostgreSQL/PostGIS previewが `http://localhost:3102`。PostGIS投入環境では `release:smoke -- --expect-standard-records` を使い、`/api/v1` の標準レコード読取を確認する。

## 3. よく使うコマンド

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | 開発サーバー起動 |
| `npm run start:checked` | 環境変数検査後に `next start` を起動 |
| `npm run build` | 本番ビルド |
| `npm run lint` | ESLint |
| `npm run test` | 単体テスト |
| `npm run test:e2e` | E2Eテスト |
| `npm run release:validate-env:local` | `DATABASE_URL=file:./dev.db` を明示したローカル環境変数検査 |
| `npm run release:gate` | ブラウザ非依存のリリース前ゲート一括実行 |
| `npm run release:gate -- --include-e2e` | E2Eを含むリリース前ゲート一括実行 |
| `npm run release:smoke` | 起動中アプリのHTTPスモーク |
| `npm run release:check-v1-contract` | v1標準レコード契約の静的確認 |
| `npm run release:check-doc-api-contract` | API設計書と実装契約の静的確認 |
| `npm run release:check-openapi-coverage` | 実装済みAPI routeのOpenAPI掲載確認 |
| `npm run release:check-docker-contract` | Dockerfile/CI供給網契約の静的確認 |
| `npm run release:check-cloudflare-contract` | Cloudflare/Neon staging契約の静的確認 |
| `npm run release:check-github-actions-contract` | GitHub Actions構文検査・危険設定防止契約の静的確認 |
| `npm run db:migrate` | SQLite local/previewへ既存migrationを適用 |
| `npm run db:migrate:dev` | schema作成者向け。新規migration生成時のみ使用 |
| `npm run db:migrate:deploy` | 指定 `DATABASE_URL` へ既存migrationを適用 |
| `npm run db:seed` | 初期データ投入 |
| `npm run db:studio` | Prisma Studio |

## 4. 実装ルール

| 項目 | 方針 |
| --- | --- |
| 型 | TypeScriptとZodで入力境界を明確にする |
| DB | Prismaスキーマを正本にする |
| 取得処理 | コネクタ方式で追加する |
| 秘密情報 | 環境変数で扱い、ログ出力しない |
| UI | 非エンジニアにも意味が伝わる文言にする |
| 地図 | 出典、基準日、取得日時を確認可能にする |
| AI | 未確認生成物として扱う |

## 5. 新しいコネクタ追加手順

1. `src/connectors/types.ts` の `DataConnector` を確認する。
2. `src/connectors/` に専用コネクタを追加する。
3. `canHandle` で対象カテゴリやURLを判定する。
4. `check` と `fetchSample` を実装する。
5. `src/connectors/registry.ts` に登録する。
6. 単体テストを追加する。
7. docsの台帳テンプレートに調査内容を残す。
