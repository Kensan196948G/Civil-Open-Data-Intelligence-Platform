# API設計書

## 1. API設計方針

CODIPのAPIは3種類に分ける。

| 種別 | パス | 利用者 | 目的 |
| --- | --- | --- | --- |
| 管理・画面用API | `/api/*` | CODIP Web UI | 台帳、取得、品質、タグ、ダッシュボード |
| 後続システム向けAPI | `/api/v1/*` | 他の土木建設DXシステム | 現行MVPは台帳メタデータの標準形式投影。標準化済みデータ検索はPostGIS投入後 |
| 運用監視API | `/api/health`, `/api/ready`, `/api/openapi` | 監視、CI、後続システム | 生存確認、DB接続確認、API契約確認 |

## 2. 共通レスポンス

```json
{
  "data": {},
  "meta": {
    "requestId": "req_20260713_0001",
    "retrievedAt": "2026-07-13T00:00:00.000Z",
    "sourceCount": 3
  },
  "warnings": []
}
```

エラーは次の形式とする。

```json
{
  "error": {
    "code": "invalid_query",
    "message": "検索条件を確認してください",
    "details": {}
  }
}
```

## 3. 管理・画面用API

| API | メソッド | 概要 |
| --- | --- | --- |
| `/api/dashboard` | GET | 台帳件数、成功率、品質状態を集計 |
| `/api/health` | GET | アプリプロセスの生存確認 |
| `/api/ready` | GET | DB接続を含むレディネス確認 |
| `/api/openapi` | GET | OpenAPI契約を返却 |
| `/api/sources` | GET | データソース一覧検索 |
| `/api/sources` | POST | データソース登録 |
| `/api/sources/{id}` | GET | データソース詳細 |
| `/api/sources/{id}` | PUT | データソース更新 |
| `/api/sources/{id}` | DELETE | データソース削除 |
| `/api/sources/{id}/check` | POST | 接続確認 |
| `/api/sources/{id}/fetch-sample` | POST | サンプル取得 |
| `/api/quality/{id}/recalculate` | POST | 品質スコア再計算 |
| `/api/fetch-logs` | GET | 取得ログ一覧 |
| `/api/tags` | GET/POST | タグ一覧・登録 |
| `/api/tags/{id}` | DELETE | タグ削除 |
| `/api/map/elevation` | GET | 緯度経度から標高取得 |
| `/api/admin/settings` | GET/PUT | 接続確認の動作設定の取得・変更 (変更は管理者のみ、監査ログへ記録) |
| `/api/admin/audit-events` | POST | クライアント操作 (エクスポート・APIキー) の監査イベント記録 (種別はサーバー側写像で固定) |

## 4. 後続システム向けAPI

現行MVPでは、PostGIS標準レコード本体の投入前に、台帳メタデータを標準レコード形式へ投影する読み取りAPIを提供する。これにより、後続システムは早期に出典、ライセンス、品質状態、取得時刻を同じレスポンス形式で扱える。

### 4.1 データ検索 実装済み

`GET /api/v1/records/search`

| パラメータ | 型 | 内容 |
| --- | --- | --- |
| `q` | string | キーワード |
| `category` | string | カテゴリ |
| `prefectureCode` | string | 都道府県コード |
| `municipalityCode` | string | 市区町村コード |
| `bbox` | string | `minLng,minLat,maxLng,maxLat` |
| `updatedSince` | string | ISO8601日時 |
| `limit` | number | 取得件数 |
| `cursor` | string | ページング |

MVP実装では `q`, `category`, `updatedSince`, `limit`, `cursor` を扱う。`bbox`, `prefectureCode`, `municipalityCode` はPostGIS標準レコード投入後に有効化する。公開検索では内部メモ `note` を検索対象に含めない。

v1の警告はすべて次のオブジェクト配列で返す。

```json
{
  "warnings": [
    { "code": "catalog_metadata_only", "severity": "info", "message": "..." },
    { "code": "decision_not_supported", "severity": "warning", "message": "..." }
  ]
}
```

v1のエラーは `429 rate_limited` を含めて `{ "error": { "code": "...", "message": "..." } }` 形式に統一する。

レスポンスは共通形式で返す。

```json
{
  "data": {
    "records": [
      {
        "recordId": "catalog:src_001",
        "sourceId": "src_001",
        "sourceRecordId": "src_001",
        "category": "gis",
        "title": "国土数値情報",
        "geometry": null,
        "retrievedAt": "2026-07-13T00:00:00.000Z",
        "sourceUrl": "https://nlftp.mlit.go.jp/ksj/",
        "licenseId": "国土数値情報利用約款",
        "qualityStatus": "usable",
        "properties": {
          "provider": { "name": "国土交通省" },
          "dataFormat": "GeoJSON",
          "accessType": "download",
          "qualityScore": 85
        }
      }
    ]
  },
  "meta": {
    "requestId": "req_xxx",
    "retrievedAt": "2026-07-13T00:00:00.000Z",
    "sourceCount": 1,
    "total": 20,
    "nextCursor": null,
    "mode": "catalog_metadata"
  },
  "warnings": [
    {
      "code": "catalog_metadata_only",
      "severity": "info",
      "message": "現行MVPは標準レコード本体ではなく、台帳メタデータを標準レコード形式へ投影しています。"
    },
    {
      "code": "decision_not_supported",
      "severity": "warning",
      "message": "施工可否・安全性・法令適合は判断しません。"
    }
  ]
}
```

### 4.2 地点照会 実装済み

`GET /api/v1/records/point`

| パラメータ | 型 | 内容 |
| --- | --- | --- |
| `lat` | number | 緯度 |
| `lng` | number | 経度 |
| `radiusM` | number | 半径メートル。未指定時は1000。指定時は1〜100000 |
| `categories` | string | カンマ区切りカテゴリ。最大20件、各64文字以内 |

PostgreSQL/PostGIS の `standard_records` に標準化済み地物が存在する環境では、`ST_DWithin` による半径検索を実行し、`records` に該当地物を返す。距離判定は `geometry::geography` でメートル単位として扱う。

ローカルSQLite previewや未投入環境では、地点包含・周辺判定は実行しない。代わりに、地点条件、空の `records`、候補レイヤー `candidateLayers`、未評価状態を示す `spatialEvaluation` を返す。

```json
{
  "data": {
    "point": { "lat": 35.681236, "lng": 139.767125, "radiusM": 1000 },
    "records": [],
    "candidateLayers": [
      {
        "layerId": "src_001",
        "sourceId": "src_001",
        "title": "土砂災害警戒区域",
        "sourceUrl": "https://example.jp",
        "licenseId": "license_name",
        "qualityStatus": "needs_review",
        "featuresUrl": "/api/v1/layers/src_001/features",
        "dataAvailability": "catalog_only",
        "geometryStatus": "not_standardized"
      }
    ],
    "spatialEvaluation": {
      "status": "not_available",
      "evaluated": false,
      "reason": "standard_records_not_ingested"
    },
    "dataAvailability": "catalog_only",
    "geometryStatus": "not_standardized"
  },
  "warnings": [
    {
      "code": "not_standardized",
      "severity": "info",
      "message": "現行MVPでは標準化済み地物を未投入のため、地点包含・周辺判定は実行していません。"
    }
  ]
}
```

`records=[]` は、`spatialEvaluation.evaluated=false` の場合は「該当なし」ではなく「未評価」を意味する。後続システムは `spatialEvaluation.evaluated` と `warnings[].code=not_standardized` を必ず確認する。

### 4.3 レイヤー一覧 実装済み

`GET /api/v1/layers`

PostgreSQL/PostGIS の `standard_records` に標準化済み地物が存在する環境では、データソース単位でレイヤーを集約し、`featureCount`、`bbox`、`capabilities.standardizedFeatures=true` を返す。

ローカルSQLite previewや未投入環境では、GeoJSON、Shapefile、CityGML、PNG、tile形式の台帳データソースをレイヤー候補として返す。標準化済み地物が未投入であることを機械処理できるよう、`dataAvailability`, `geometryStatus`, `featureCount`, `bbox`, `capabilities` を含める。

| 項目 | 内容 |
| --- | --- |
| `layerId` | レイヤーID。現行MVPではデータソースID |
| `sourceId` | データソースID |
| `title` | レイヤー名 |
| `dataFormat` | GeoJSON、Shapefile、CityGML等 |
| `featuresUrl` | FeatureCollection取得URL |
| `dataAvailability` | `catalog_only` など、地物本体の提供状態 |
| `geometryStatus` | `not_standardized` など、形状標準化状態 |
| `featureCount` | 標準化済み地物数。未投入時は `null` |
| `bbox` | 対象範囲。未投入時は `null` |
| `capabilities` | `format`, `bbox`, `standardizedFeatures` |

### 4.4 レイヤー地物取得 実装済み

`GET /api/v1/layers/{layerId}/features`

| パラメータ | 型 | 内容 |
| --- | --- | --- |
| `bbox` | string | 表示範囲 |
| `format` | string | `geojson` を基本とする |
| `limit` | integer | 取得件数。未指定時1000、最大5000 |
| `cursor` | integer | オフセットカーソル。0以上 |

`format=geojson` のみ対応する。PostGIS投入環境では `standard_records.geometry` を `ST_AsGeoJSON` でGeoJSON FeatureCollectionへ変換し、`bbox` 指定時は `ST_Intersects` で絞り込む。返却件数が `limit` を超える場合は `metadata.nextCursor` と `metadata.truncated=true` を返す。

存在するレイヤーで標準化済み地物が未投入の場合は、`404` ではなく空のGeoJSON FeatureCollectionを返し、`warnings` に `code: "not_standardized"` を含める。これにより、後続システムは「レイヤーが存在しない」と「地物本体が未投入」を区別できる。

```json
{
  "type": "FeatureCollection",
  "features": [],
  "metadata": {
    "layerId": "src_001",
    "sourceId": "src_001",
    "title": "土砂災害警戒区域",
    "sourceUrl": "https://example.jp",
    "licenseId": "license_name",
    "qualityStatus": "needs_review",
    "standardizedFeatures": false,
    "dataAvailability": "catalog_only",
    "geometryStatus": "not_standardized",
    "featureCount": 0,
    "bbox": null,
    "mode": "catalog_layer_metadata"
  },
  "warnings": [
    {
      "code": "not_standardized",
      "severity": "info",
      "message": "現行MVPでは標準化済み地物を未投入のため、featuresは空配列です。",
      "sourceId": "src_001",
      "mode": "catalog_layer_metadata"
    }
  ]
}
```

### 4.5 データ鮮度 実装済み

`GET /api/v1/sources/{sourceId}/freshness`

最終確認日時、取得日時、最終成功日時、連続失敗数、品質状態を返す。

MVP実装では、台帳の `lastCheckedAt`、直近取得ログ、品質スコア、データソース状態から次を返す。

| 項目 | 内容 |
| --- | --- |
| `status` | 台帳上の接続状態 |
| `qualityStatus` | `usable` / `needs_review` / `unverified` / `deprecated` |
| `qualityScore` | 台帳上の品質スコア |
| `lastCheckedAt` | 台帳の最終確認日時 |
| `lastSuccessAt` | 直近成功ログ日時 |
| `lastFailureAt` | 直近失敗ログ日時 |
| `consecutiveFailureCount` | 直近から連続する失敗数 |

### 4.6 地点横断評価 実装済み

`GET /api/v1/assessments/point?lat=&lng=&radiusM=&categories=`

PostGIS `standard_records` が存在する環境では、指定地点の半径内レコードをカテゴリ・レイヤー別に集計し、最短距離（Point地物のみ近似値）を返す。未投入環境では候補レイヤーと `not_standardized` / `catalog_point_cross_section` 警告を返す。施工可否・安全性・法令適合の最終判断には使用しない（`decision_not_supported`）。

### 4.6a ジオメトリ空間評価 実装済み

`POST /api/v1/assessments/geometry`

```json
{
  "mode": "circle",
  "center": { "lat": 35.44, "lng": 139.64 },
  "radiusM": 1000,
  "bufferM": 100,
  "q": "橋梁",
  "limit": 100,
  "cursor": 0
}
```

`mode` は `circle` / `bbox` / `polygon`。`bbox` は `[minLng,minLat,maxLng,maxLat]`、`polygon` はGeoJSONオブジェクト。`bufferM` でバッファ拡張、`q` でタイトル・住所・プロパティのキーワード絞込が可能。`circle` では距離順（最近傍）で返す。未投入環境では候補レイヤーと `catalog_geometry_assessment` 警告を返す。

### 4.7 データリネージュ 実装済み

`GET /api/v1/sources/{id}/lineage`

出典→定期収集ジョブ→実行履歴→標準レコード件数の追跡情報を返す。実行履歴には挿入・更新・スキップ件数、ステータスコード、エラー、ETag/Last-Modifiedの有無を含める。

### 4.8 データソース推薦（AIコンシェルジュ） 実装済み

`GET /api/v1/recommendations?query=横浜 橋梁 浸水&limit=5`

キーワード・カテゴリ・タグ・品質スコア・利用シーンによるルールベース推薦を、推薦理由・地図レイヤーURL付きで返す。警告コードは `rule_based_ai` で、LLM/RAG導入前の実装であることを明示する。

### 4.9 定期収集ジョブ管理API 実装済み

| API | メソッド | 目的 |
| --- | --- | --- |
| `/api/admin/ingestion/jobs` | GET / POST | 定期収集ジョブ一覧・作成 |
| `/api/admin/ingestion/jobs/{id}` | PATCH / DELETE | 定期収集ジョブ更新・削除 |
| `/api/admin/ingestion/jobs/{id}/run` | POST | ジョブの手動実行（Node/preview環境向け） |
| `/api/admin/ingestion/runs` | GET | 実行履歴一覧（status/limitで絞込） |
| `/api/admin/ingestion/quality-summary` | GET | 品質監視サマリー（デッドレター・スキーマ変化・停滞ジョブ・件数異常） |

定期実行はGitHub Actions `data-ingestion.yml` が30分毎に `scripts/ingestion/run-due-jobs.js` を実行する。ジョブはETag/Last-Modifiedによる差分判定、上限サイズ/レコード数、リトライ（指数バックオフ）、SSRFガード（静的検証＋接続時DNSピン留め）、CSV/GeoJSON/JSON解析、標準レコードupsert、リネージュ記録に対応する。**提供元別レート制限**（`providers.ingestionRateLimitMinutes`）、**スキーマドリフト検出**（取得列のフィンガープリント比較）、**デッドレターキュー**（リトライ上限到達・parse失敗を `dead_letter` として保存）にも対応する。Workersランタイムでは外部URL取得が `unsupported_runtime` のため、本番の定期実行はGitHub Actionsが担う。

### 4.10 地形分析API (統合: Civil-Terrain-Slope-Risk-Viewer) 実装済み

地形分析は国土地理院 標高タイル (DEM1A/DEM5A/DEM5B/DEM5C/DEM10B) を
`cyberjapandata.gsi.go.jp` の allowlist + https のみで取得し、サーバー側で
Horn法 (3x3近傍勾配) と TPI (地形位置指数) による解析を行う。

| API | メソッド | 概要 |
| --- | --- | --- |
| `/api/v1/terrain/elevation` | GET | `lat`/`lon` の標高・出典・品質 (Provenance付き) |
| `/api/v1/terrain/analysis` | GET | 周辺約160m四方の傾斜統計・地形分類・品質 |
| `/api/v1/terrain/section` | GET | 始点→終点 (30m〜20km) の縦断プロファイル・勾配統計 |
| `/api/v1/terrain/confirm` | GET | 実測メトリクスのルール評価による確認支援カード |
| `/api/v1/terrain/export` | GET | Markdown/CSV/JSON レポート出力 |
| `/api/v1/terrain/runs` | GET/POST | 保存済み地形案件一覧・保存 (管理認証) |

共通仕様:

- 応答は `data` / `meta` / `warnings` 形式。`warnings` には必ず
  `decision_not_supported` (施工可否・安全性・法令適合を断定しない) を含める。
- データ欠損・取得失敗は安全として扱わない。`no_coverage` (404) は
  「データがない」、`upstream_unavailable` (503) は「不在を断定できない」を意味する。
- 欠損セルは補間しない。欠損率・判定不能セル数を明示する。
- 複数カードの単純加算による総合危険度は提供しない。
- レート制限は地形系API共通で 60〜120 回/分、解析結果は5分間のTTLキャッシュを持つ。

### 4.11 気象・海象・施工判定API (統合: wmcdss) 実装済み

| API | メソッド | 概要 |
| --- | --- | --- |
| `/api/v1/sites` | GET/POST | 現場一覧・登録 (kind: land/marine/both) |
| `/api/v1/thresholds` | GET/POST | 閾値一覧 (siteId指定時はグローバル含む)・登録 |
| `/api/v1/thresholds/{id}` | PATCH/DELETE | 閾値更新・削除 |
| `/api/v1/observations/weather` | GET/POST | 気象観測一覧・取り込み (siteId/observedAt/dataVersion でupsert) |
| `/api/v1/observations/weather/latest` | GET | 最新気象観測 |
| `/api/v1/observations/marine` | GET/POST | 海象観測一覧・取り込み |
| `/api/v1/observations/marine/latest` | GET | 最新海象観測 |
| `/api/v1/weather/forecast` | GET | 週間予報 (Open-Meteo 参考情報・30分キャッシュ) |
| `/api/v1/weather/ai-analysis` | GET | AI参考解説 (ルールベース・参考情報) |
| `/api/v1/decisions` | POST | 施工可否判定 (go/caution/stop + 監査スナップショット) |
| `/api/v1/analysis/historical` | GET | 月次履歴統計 (気象・海象) |
| `/api/v1/analysis/wave50` | GET | 50年確率波推算 (Gumbel/Weibull) |
| `/api/v1/etl/status` | GET | AMeDAS/Open-Meteo Marine 取り込み状態 |
| `/api/v1/etl/run/{id}` | POST | ETL手動実行 (Node環境のみ。Workersはworkflow_dispatchで実行) |
| `/api/v1/reports` | POST | 日次/週次/月次/判定/海象/年次レポート (CSV/Markdown) |

判定仕様 (wmcdss の fail-closed 設計を踏襲):

- 評価できなかったルールが1件でもあれば `go` にしない (欠測・設定不正は caution)
- 判定結果とともに `matched_rules` / `unevaluated_rules` / `out_of_effect_rules` /
  `evaluated_count` を監査スナップショットへ保存し、事後再構成を可能にする
- しきい値の有効期間は判定対象の施工時間帯 (JST暦日) との重なりで判定
- Open-Meteo Marine は `source=open_meteo_marine_info` として参考情報のみ保存し、
  判定入力から除外する
- 書き込み系は管理認証必須。`warnings` には `decision_not_supported` を含める

## 5. 標準レコード形式

```json
{
  "recordId": "std_001",
  "sourceId": "src_001",
  "sourceRecordId": "external_001",
  "category": "disaster",
  "title": "土砂災害警戒区域",
  "description": "公開元の説明",
  "prefectureCode": "14",
  "municipalityCode": "14100",
  "address": "神奈川県横浜市",
  "geometry": {
    "type": "Polygon",
    "coordinates": []
  },
  "observedAt": null,
  "publishedAt": "2026-07-01T00:00:00.000Z",
  "retrievedAt": "2026-07-13T00:00:00.000Z",
  "validFrom": null,
  "validTo": null,
  "sourceUrl": "https://example.jp/source",
  "licenseId": "license_001",
  "qualityStatus": "needs_review",
  "rawDataReference": "raw/2026/07/source.zip",
  "properties": {}
}
```

## 6. API安全設計

| 項目 | 方針 |
| --- | --- |
| 認証 | 変更系API、取得ログ、サンプルレスポンスは `CODIP_ADMIN_TOKEN`、またはCloudflare Access等のプロキシ認証を必須にする |
| レート制限 | 公開APIと外部取得を伴う管理APIはIP単位のレート制限を行う |
| ログ | 個人情報、APIキー、認証ヘッダーを保存しない |
| キャッシュ | 読取APIは鮮度要件に応じてキャッシュ可能 |
| 出典 | すべてのレスポンスに出典、基準日、取得日時、ライセンスを含める |

### 6.1 レート制限

| API | 制限 | 理由 |
| --- | --- | --- |
| `/api/dashboard` | 120 req/min/IP | 集計クエリを公開GETで実行するため |
| `/api/sources` | 120 req/min/IP | 検索と件数取得を公開GETで実行するため |
| `/api/map/elevation` | 60 req/min/IP | 未認証で外部API取得を行うため |
| `/api/sources/{id}/check` | 12 req/min/IP/source | 管理者操作でも公開元APIへ負荷をかけるため |
| `/api/sources/{id}/fetch-sample` | 6 req/min/IP/source | 本文取得とDB保存を伴うため |
| `/api/v1/assessments/point` | 120 req/min/IP | 標準レコード空間集計 |
| `/api/v1/recommendations` | 120 req/min/IP | ルールベース推薦 |
| `/api/v1/sources/{id}/lineage` | 120 req/min/IP | リネージュ取得 |
| `/api/v1/assessments/geometry` | 60 req/min/IP | 空間評価（POST） |
| `/api/admin/ingestion/*` | 10〜60 req/min/IP | 定期収集ジョブ操作 |

制限超過時は `429 rate_limited` と `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` を返す。

`/api/sources` は `take` 最大200、`skip` 最大5000、キーワード検索は2文字以上とする。`/api/map/elevation` は同一緯度経度を小数5桁で丸め、10分間メモリキャッシュする。キャッシュヒット時は外部API取得と取得ログ作成を行わず、`X-CODIP-Cache: hit` を返す。

## 7. 管理API認証

`CODIP_ADMIN_TOKEN` が未設定、かつ `CODIP_TRUST_PROXY_AUTH=true`、`CODIP_TRUST_PROXY_SECRET`、管理者メールallowlistによるプロキシ信頼設定も成立しない場合、登録・編集・削除・取得実行・品質再計算は `503 admin_guard_not_configured` を返す。

| 方式 | 条件 |
| --- | --- |
| 管理セッションCookie | 設定画面で `CODIP_ADMIN_TOKEN` を照合し、発行時刻・期限・nonceを署名したHttpOnly Cookieを発行。HTTPSでは `__Host-codip_admin_session`。HTTPローカル検証で `CODIP_ALLOW_INSECURE_LOCAL_COOKIES=true` の場合のみ `codip_admin_session` |
| 管理トークン | APIクライアントはリクエストヘッダー `x-codip-admin-token` または `Authorization: Bearer` に `CODIP_ADMIN_TOKEN` と同じ値を設定 |
| Cloudflare Access信頼 | `CODIP_TRUST_PROXY_AUTH=true`、`cf-access-authenticated-user-email` ヘッダーが存在、`x-codip-proxy-secret` が `CODIP_TRUST_PROXY_SECRET` と一致、かつ `CODIP_ADMIN_EMAILS` または `CODIP_ADMIN_EMAIL_DOMAINS` に一致 |
| ローカル開発 | `NODE_ENV !== "production"` かつ `CODIP_ALLOW_INSECURE_ADMIN=true` の場合のみ許可 |

`cf-access-authenticated-user-email` は直接アクセスではクライアントが偽装できるため、単独では信頼しない。

ブラウザUIは管理トークンをlocalStorageへ保存しない。`/api/admin/session` が署名済みHttpOnly Cookieを発行・削除する。Cookie認証で変更系管理APIを呼ぶ場合は、同一Origin、または `CODIP_ALLOWED_ORIGINS` に含まれるOriginからのリクエストだけを許可する。管理セッション開始は `5 req/min/IP` に制限する。

## 8. 運用監視API

| API | メソッド | 目的 | DB依存 | 正常時 |
| --- | --- | --- | --- | --- |
| `/api/health` | GET | アプリプロセスの生存確認 | なし | `200` / `status: ok` |
| `/api/ready` | GET | DB接続を含む起動準備確認 | あり | `200` / `status: ready` |
| `/api/openapi` | GET | 後続システムとレビュー用のAPI契約確認 | なし | OpenAPI `3.1.0` |

監視では、プロセス死活は `/api/health`、DB障害やmigration不整合を含めた利用可否は `/api/ready` を見る。
DB障害時の `/api/ready` は内部例外や接続先を公開せず、`503` と `readiness_dependency_failed` のみを返す。

## 9. ログ・サンプルレスポンスの扱い

取得ログとサンプルレスポンス本文は、接続先URL、エラー内容、運用状態、ライセンス制限付きデータを含む可能性があるため公開APIレスポンスから分離する。

| 対象 | 方針 |
| --- | --- |
| `/api/fetch-logs` | 管理認証必須 |
| `/api/sources/{id}` の `fetchLogs` | 管理認証時のみ含める |
| `/api/sources/{id}` の `sampleResponses` | 管理認証時のみ含める |
| APIキー必須データソースのサンプル本文 | 成功してもDBへ保存しない |
| `/api/dashboard` の `recentLogs` | 管理認証時のみ含める |
