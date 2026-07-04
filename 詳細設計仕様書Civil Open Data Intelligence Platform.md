# 詳細設計仕様書

## Civil Open Data Intelligence Platform

### 土木建設オープンデータ統合分析基盤

## 1. システム構成

## 1.1 推奨アーキテクチャ

MVPでは、Windows 11上で開発しやすいWebアプリ構成とする。

```text
[Browser]
   |
   v
[Next.js Web UI]
   |
   v
[API Layer / Server Actions]
   |
   +--> [API Catalog Service]
   +--> [Search Service]
   +--> [Fetch Service]
   +--> [Quality Check Service]
   +--> [AI Assist Service]
   |
   v
[SQLite Database]
   |
   v
[Sample Response Storage]
```

## 1.2 技術スタック

| 区分      | 採用候補                         | 理由                                |
| ------- | ---------------------------- | --------------------------------- |
| フロントエンド | Next.js / React / TypeScript | Claude Codeで扱いやすく、画面とAPIを一体で作りやすい |
| UI      | Tailwind CSS                 | 画面を素早く整えやすい                       |
| API     | Next.js Route Handlers       | MVPでバックエンドを分離しすぎない                |
| DB      | SQLite                       | Windows 11ローカル開発に適する              |
| ORM     | Prisma                       | 型安全、スキーマ管理がしやすい                   |
| バリデーション | Zod                          | 入力チェックと型定義を統一しやすい                 |
| HTTP取得  | fetch / axios                | 外部API疎通確認に利用                      |
| テスト     | Vitest / Playwright          | 単体・画面テストに対応                       |
| 将来DB    | PostgreSQL / PostGIS         | 空間検索・本番運用を見据える                    |
| AI連携    | 任意                           | 要約・分類補助。MVPではモックでも可               |

## 2. リポジトリ構成

推奨構成は以下とする。

```text
Civil-Open-Data-Intelligence-Platform/
├─ README.md
├─ docs/
│  ├─ requirements.md
│  ├─ detailed-design.md
│  ├─ claude-code-instructions.md
│  ├─ api-source-register-template.md
│  ├─ data-quality-policy.md
│  ├─ security-checklist.md
│  └─ test-plan.md
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ app/
│  │  ├─ page.tsx
│  │  ├─ sources/
│  │  │  ├─ page.tsx
│  │  │  ├─ new/page.tsx
│  │  │  └─ [id]/page.tsx
│  │  ├─ logs/page.tsx
│  │  ├─ tags/page.tsx
│  │  └─ settings/page.tsx
│  ├─ components/
│  │  ├─ DataSourceCard.tsx
│  │  ├─ SearchFilter.tsx
│  │  ├─ StatusBadge.tsx
│  │  ├─ QualityScoreBadge.tsx
│  │  └─ FetchLogTable.tsx
│  ├─ features/
│  │  ├─ api-catalog/
│  │  ├─ search/
│  │  ├─ fetch/
│  │  ├─ quality/
│  │  └─ ai-assist/
│  ├─ lib/
│  │  ├─ db.ts
│  │  ├─ http-client.ts
│  │  ├─ validators.ts
│  │  ├─ constants.ts
│  │  └─ logger.ts
│  └─ connectors/
│     ├─ gsi-elevation.ts
│     ├─ jma-xml.ts
│     ├─ estat.ts
│     ├─ xroad.ts
│     ├─ plateau.ts
│     └─ ksj.ts
├─ tests/
│  ├─ unit/
│  └─ e2e/
├─ data/
│  ├─ samples/
│  └─ exports/
├─ .env.example
├─ .gitignore
├─ package.json
└─ tsconfig.json
```

既存の `Global-Civil-API-Catalog` リポジトリを使う場合は、以下のように読み替える。

```text
Global-Civil-API-Catalog/
├─ docs/
├─ src/
│  ├─ features/api-catalog/
│  ├─ features/open-data-intelligence/
│  └─ connectors/
```

ただし、将来の拡張を考えると、`Global-Civil-API-Catalog` は「台帳」、`Civil-Open-Data-Intelligence-Platform` は「活用基盤」として分ける方が整理しやすい。

## 3. データベース設計

## 3.1 ER概要

```text
Provider 1 --- N DataSource
DataSource 1 --- N FetchLog
DataSource N --- N Tag
DataSource 1 --- N SampleResponse
DataSource 1 --- N QualityCheck
DataSource 1 --- N RelatedUseCase
```

## 3.2 テーブル定義

### providers

| カラム              | 型        |  必須 | 説明                                     |
| ---------------- | -------- | --: | -------------------------------------- |
| id               | string   | Yes | Provider ID                            |
| name             | string   | Yes | 提供元名                                   |
| organizationType | string   | Yes | national / local / private / community |
| officialUrl      | string   |  No | 公式URL                                  |
| country          | string   |  No | 国                                      |
| note             | text     |  No | 備考                                     |
| createdAt        | datetime | Yes | 作成日時                                   |
| updatedAt        | datetime | Yes | 更新日時                                   |

### data_sources

| カラム                 | 型        |  必須 | 説明                                        |
| ------------------- | -------- | --: | ----------------------------------------- |
| id                  | string   | Yes | データソースID                                  |
| providerId          | string   | Yes | 提供元ID                                     |
| name                | string   | Yes | データソース名                                   |
| nameEn              | string   |  No | 英語名                                       |
| description         | text     |  No | 概要                                        |
| officialUrl         | string   | Yes | 公式URL                                     |
| endpointUrl         | string   |  No | API URL                                   |
| documentationUrl    | string   |  No | API仕様書URL                                 |
| category            | string   | Yes | road / weather / gis / disaster 等         |
| dataFormat          | string   | Yes | JSON / XML / CSV / GeoJSON / HTML / PDF 等 |
| accessType          | string   | Yes | API / download / tile / web / manual      |
| requiresApiKey      | boolean  | Yes | APIキー要否                                   |
| licenseName         | string   |  No | ライセンス名                                    |
| commercialUse       | string   |  No | allowed / restricted / unknown            |
| attributionRequired | boolean  |  No | 出典表記要否                                    |
| updateFrequency     | string   |  No | daily / monthly / irregular 等             |
| lastCheckedAt       | datetime |  No | 最終確認日時                                    |
| status              | string   | Yes | active / unstable / deprecated / unknown  |
| trustLevel          | integer  | Yes | 1〜5                                       |
| qualityScore        | integer  | Yes | 0〜100                                     |
| note                | text     |  No | 備考                                        |
| createdAt           | datetime | Yes | 作成日時                                      |
| updatedAt           | datetime | Yes | 更新日時                                      |

### tags

| カラム       | 型        |  必須 | 説明   |
| --------- | -------- | --: | ---- |
| id        | string   | Yes | タグID |
| name      | string   | Yes | タグ名  |
| color     | string   |  No | 表示色  |
| createdAt | datetime | Yes | 作成日時 |

### data_source_tags

| カラム          | 型      |  必須 | 説明       |
| ------------ | ------ | --: | -------- |
| dataSourceId | string | Yes | データソースID |
| tagId        | string | Yes | タグID     |

### fetch_logs

| カラム               | 型        |  必須 | 説明                                 |
| ----------------- | -------- | --: | ---------------------------------- |
| id                | string   | Yes | ログID                               |
| dataSourceId      | string   | Yes | データソースID                           |
| requestUrl        | string   | Yes | 取得URL                              |
| method            | string   | Yes | GET / POST                         |
| statusCode        | integer  |  No | HTTPステータス                          |
| success           | boolean  | Yes | 成功可否                               |
| responseTimeMs    | integer  |  No | 応答時間                               |
| responseSizeBytes | integer  |  No | サイズ                                |
| contentType       | string   |  No | Content-Type                       |
| errorType         | string   |  No | timeout / network / parse / auth 等 |
| errorMessage      | text     |  No | エラー内容                              |
| executedAt        | datetime | Yes | 実行日時                               |

### sample_responses

| カラム            | 型        |  必須 | 説明         |
| -------------- | -------- | --: | ---------- |
| id             | string   | Yes | サンプルID     |
| dataSourceId   | string   | Yes | データソースID   |
| fetchLogId     | string   |  No | 取得ログID     |
| previewText    | text     |  No | レスポンスプレビュー |
| filePath       | string   |  No | 保存ファイルパス   |
| detectedFormat | string   |  No | 判定形式       |
| createdAt      | datetime | Yes | 作成日時       |

### quality_checks

| カラム                        | 型        |  必須 | 説明       |
| -------------------------- | -------- | --: | -------- |
| id                         | string   | Yes | 品質チェックID |
| dataSourceId               | string   | Yes | データソースID |
| officialSourceScore        | integer  | Yes | 公式性      |
| freshnessScore             | integer  | Yes | 鮮度       |
| accessibilityScore         | integer  | Yes | 取得容易性    |
| licenseClarityScore        | integer  | Yes | 利用条件明確性  |
| formatUsabilityScore       | integer  | Yes | 形式の扱いやすさ |
| constructionRelevanceScore | integer  | Yes | 土木建設関連度  |
| totalScore                 | integer  | Yes | 合計       |
| checkNote                  | text     |  No | メモ       |
| checkedAt                  | datetime | Yes | チェック日時   |

### related_use_cases

| カラム          | 型      |  必須 | 説明       |
| ------------ | ------ | --: | -------- |
| id           | string | Yes | ユースケースID |
| dataSourceId | string | Yes | データソースID |
| useCaseName  | string | Yes | 活用候補名    |
| targetSystem | string |  No | 連携先候補    |
| description  | text   |  No | 説明       |

## 4. 主要画面設計

## 4.1 ダッシュボード

### 表示項目

* 登録データソース数
* 接続成功数
* 接続失敗数
* 要確認数
* カテゴリ別件数
* 提供元別件数
* 最近追加されたデータソース
* 最近の取得ログ

### コンポーネント

* SummaryCard
* CategoryChart
* ProviderList
* RecentFetchLogTable
* AlertDataSourceList

## 4.2 データソース一覧画面

### 検索条件

* キーワード
* カテゴリ
* 提供元
* データ形式
* APIキー要否
* ステータス
* 信頼度
* 品質スコア
* 最終確認日

### 一覧表示項目

* データソース名
* 提供元
* カテゴリ
* 形式
* APIキー要否
* 接続状態
* 品質スコア
* 最終確認日
* 詳細ボタン

## 4.3 データソース詳細画面

### 表示タブ

1. 基本情報
2. 利用条件
3. サンプルリクエスト
4. サンプルレスポンス
5. 取得ログ
6. 品質評価
7. 関連ユースケース
8. AIメモ

## 4.4 データソース登録・編集画面

### 入力チェック

* データソース名は必須
* 提供元は必須
* 公式URLはURL形式
* APIキー要否は必須
* カテゴリは選択式
* データ形式は選択式
* 信頼度は1〜5
* 品質スコアは0〜100

## 4.5 接続確認画面

### 操作

* 疎通確認
* サンプル取得
* レスポンス形式判定
* ログ保存
* サンプルプレビュー保存

### 制御

* タイムアウトは30秒
* リトライは最大1回
* APIキーが必要なデータソースは `.env` にキー名だけ設定する
* APIキーの値は画面に表示しない

## 5. API設計

## 5.1 内部API一覧

| メソッド   | パス                            | 内容         |
| ------ | ----------------------------- | ---------- |
| GET    | /api/sources                  | データソース検索   |
| POST   | /api/sources                  | データソース登録   |
| GET    | /api/sources/:id              | データソース詳細取得 |
| PUT    | /api/sources/:id              | データソース更新   |
| DELETE | /api/sources/:id              | データソース削除   |
| POST   | /api/sources/:id/check        | 接続確認       |
| POST   | /api/sources/:id/fetch-sample | サンプル取得     |
| GET    | /api/fetch-logs               | 取得ログ一覧     |
| GET    | /api/tags                     | タグ一覧       |
| POST   | /api/tags                     | タグ登録       |
| GET    | /api/dashboard                | ダッシュボード集計  |
| POST   | /api/quality/:id/recalculate  | 品質スコア再計算   |
| POST   | /api/ai/suggest-tags          | AIタグ候補生成   |
| POST   | /api/ai/summarize-source      | AI概要要約     |

## 5.2 接続確認API仕様

### Request

```json
{
  "dataSourceId": "source_001",
  "targetUrl": "https://example.com/api",
  "method": "GET"
}
```

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "responseTimeMs": 532,
  "contentType": "application/json",
  "responseSizeBytes": 2048,
  "detectedFormat": "JSON",
  "logId": "log_001"
}
```

## 5.3 エラーレスポンス

```json
{
  "success": false,
  "errorType": "timeout",
  "message": "Request timed out after 30000ms",
  "logId": "log_002"
}
```

## 6. コネクタ設計

## 6.1 Connector Interface

```ts
export type ConnectorResult = {
  success: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  contentType?: string;
  responseSizeBytes?: number;
  detectedFormat?: string;
  previewText?: string;
  errorType?: string;
  errorMessage?: string;
};

export interface DataConnector {
  name: string;
  canHandle(source: DataSource): boolean;
  check(source: DataSource): Promise<ConnectorResult>;
  fetchSample(source: DataSource): Promise<ConnectorResult>;
}
```

## 6.2 初期コネクタ

| コネクタ             | 対象        | 初期処理                  |
| ---------------- | --------- | --------------------- |
| ksjConnector     | 国土数値情報    | 公式URL疎通、ダウンロードページ確認   |
| plateauConnector | PLATEAU   | ポータル・データURL疎通、形式確認    |
| xroadConnector   | xROAD     | API仕様URL、ビューア、関連API疎通 |
| gsiConnector     | 地理院タイル・標高 | 指定緯度経度の標高取得テスト        |
| jmaXmlConnector  | 気象庁XML    | Atomフィード取得、XML形式確認    |
| estatConnector   | e-Stat    | APIキー有無確認、API仕様疎通     |

## 7. データ品質スコア設計

## 7.1 スコア配点

| 項目          |  配点 |
| ----------- | --: |
| 公式性         |  20 |
| 鮮度          |  15 |
| 接続安定性       |  15 |
| 利用条件明確性     |  15 |
| データ形式の扱いやすさ |  15 |
| 土木建設業務との関連度 |  20 |
| 合計          | 100 |

## 7.2 信頼度

| 信頼度 | 基準                       |
| --: | ------------------------ |
|   5 | 国・公的機関の公式データ、利用条件明確、接続安定 |
|   4 | 自治体・公的関連団体、利用条件おおむね明確    |
|   3 | 民間・研究機関等、利用条件確認が必要       |
|   2 | 出所は確認できるが更新・仕様が不安定       |
|   1 | 出所・更新・利用条件に不明点が多い        |

## 8. AI支援設計

## 8.1 AI機能

| 機能       | 内容               |
| -------- | ---------------- |
| 概要要約     | API説明文や仕様メモを短く要約 |
| タグ推薦     | データ内容からタグ候補を提示   |
| ユースケース推薦 | 土木建設業務での活用候補を提示  |
| 類似データ推薦  | 似たデータソースを提示      |
| エラー原因推測  | 接続失敗時の原因候補を提示    |

## 8.2 AI利用制限

* AI結果は「提案」として表示する。
* 利用条件、商用利用可否、施工可否、安全可否はAIに確定させない。
* AIが生成した内容には「AI生成メモ」と表示する。
* 公式情報と矛盾する場合は公式情報を優先する。

## 9. 初期seedデータ

最低限、以下を登録する。

```text
1. 国土数値情報
2. PLATEAU
3. xROAD
4. 道路データプラットフォーム
5. 国土交通省交通量API
6. 国土地理院 地理院タイル
7. 国土地理院 標高取得
8. 気象庁 防災情報XML
9. e-Stat API
10. OpenStreetMap
```

## 10. テスト設計

## 10.1 単体テスト

| 対象             | テスト内容                       |
| -------------- | --------------------------- |
| validators     | URL、必須項目、スコア範囲チェック          |
| searchService  | キーワード、カテゴリ、提供元検索            |
| fetchService   | 成功、失敗、タイムアウト                |
| qualityService | スコア計算                       |
| connector      | canHandle、check、fetchSample |

## 10.2 E2Eテスト

| シナリオ     | 内容             |
| -------- | -------------- |
| データソース登録 | 入力→保存→一覧表示     |
| 検索       | 条件指定→結果表示      |
| 詳細表示     | 一覧→詳細→基本情報確認   |
| 接続確認     | 詳細→接続確認→ログ保存   |
| ログ確認     | 接続確認後、ログ一覧に表示  |
| タグ登録     | タグ追加→データソースに付与 |

## 11. エラー設計

| エラー種別         | 表示メッセージ            | ログ         |
| ------------- | ------------------ | ---------- |
| timeout       | 接続がタイムアウトしました      | timeout    |
| network       | ネットワーク接続に失敗しました    | network    |
| invalid_url   | URL形式が正しくありません     | validation |
| auth_required | APIキーまたは認証が必要です    | auth       |
| parse_error   | レスポンス形式を判定できませんでした | parse      |
| rate_limited  | アクセス制限の可能性があります    | rate_limit |
| unknown       | 不明なエラーが発生しました      | unknown    |

## 12. セキュリティ設計

## 12.1 Git管理

`.gitignore` に以下を含める。

```text
.env
.env.local
*.db
data/samples/*
data/exports/*
node_modules/
.next/
```

## 12.2 APIキー管理

* `.env.example` にキー名のみ記載する。
* APIキーの値は保存しない。
* 画面にAPIキーの値を表示しない。
* ログにAPIキーを出力しない。

## 12.3 外部アクセス制御

* 取得対象は登録済みURLに限定する。
* 任意URL取得機能はMVPでは実装しない。
* SSRF対策として、localhost、private IP、社内IPへのアクセスを禁止する。
* リダイレクト回数を制限する。

## 13. 開発手順

## 13.1 初期セットアップ

```bash
npm install
npm run dev
```

## 13.2 DB初期化

```bash
npx prisma migrate dev
npx prisma db seed
```

## 13.3 テスト

```bash
npm run test
npm run test:e2e
```

## 13.4 ビルド

```bash
npm run build
```

## 14. Claude Code向け実装順序

### Step 1: プロジェクト初期化

* Next.js / TypeScript構成を作成
* Tailwind CSSを設定
* PrismaとSQLiteを設定
* READMEとdocsフォルダを作成

### Step 2: DB設計

* Prisma schemaを作成
* providers
* data_sources
* tags
* data_source_tags
* fetch_logs
* sample_responses
* quality_checks
* related_use_cases

### Step 3: seedデータ作成

* 初期10件の公開データソースを登録
* 初期タグを登録
* providerを登録

### Step 4: 台帳機能

* 一覧画面
* 詳細画面
* 登録画面
* 編集画面
* 削除処理

### Step 5: 検索機能

* キーワード検索
* カテゴリ検索
* 提供元検索
* データ形式検索
* APIキー要否検索

### Step 6: 接続確認機能

* HTTP取得処理
* タイムアウト
* Content-Type判定
* レスポンスサイズ取得
* fetch_logs保存

### Step 7: サンプル取得

* レスポンスプレビュー保存
* 形式判定
* sample_responses保存

### Step 8: ダッシュボード

* 件数集計
* 接続成功・失敗集計
* 最近のログ表示
* 要確認データソース表示

### Step 9: 品質スコア

* スコア計算
* 品質評価画面
* 要確認フラグ表示

### Step 10: テスト・ドキュメント

* 単体テスト
* E2Eテスト
* README更新
* 操作手順書作成

## 15. 完了条件

* `npm run build` が成功する。
* `npm run test` が成功する。
* 初期データ10件が登録される。
* データソースを新規登録できる。
* 検索できる。
* 詳細表示できる。
* 接続確認できる。
* 取得ログが保存される。
* サンプルレスポンスプレビューが保存される。
* ダッシュボードに件数が表示される。
* `.env` がGit管理されない。
* READMEに起動方法、DB初期化方法、テスト方法が記載されている。
