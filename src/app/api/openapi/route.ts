import { NextResponse } from "next/server";

export const dynamic = "force-static";

const sourceSummary = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    officialUrl: { type: "string", format: "uri" },
    category: { type: "string" },
    dataFormat: { type: "string" },
    accessType: { type: "string" },
    status: { type: "string" },
    qualityScore: { type: "integer", minimum: 0, maximum: 100 },
    provider: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
    },
  },
} as const;

const v1ErrorResponse = {
  description: "v1共通エラー",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/V1ErrorResponse" },
    },
  },
} as const;

const v1Warnings = {
  type: "array",
  items: { $ref: "#/components/schemas/V1Warning" },
} as const;

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "CODIP API",
    version: "0.1.0",
    description:
      "Civil Open Data Intelligence Platform のMVP API。公開データソース台帳、取得ログ、品質確認、監視用エンドポイントを提供する。",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "operations", description: "監視・稼働確認" },
    { name: "admin", description: "管理セッション・管理操作" },
    { name: "catalog", description: "データソース台帳" },
    { name: "quality", description: "品質確認" },
    { name: "downstream", description: "後続システム向け共通API" },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["operations"],
        summary: "アプリケーションの生存確認",
        responses: {
          "200": {
            description: "アプリケーションプロセスが応答可能",
          },
        },
      },
    },
    "/api/ready": {
      get: {
        tags: ["operations"],
        summary: "依存先を含めたレディネス確認",
        responses: {
          "200": { description: "DB接続を含めて利用可能" },
          "503": { description: "DB接続など依存先に問題がある" },
        },
      },
    },
    "/api/openapi": {
      get: {
        tags: ["operations"],
        summary: "OpenAPI 3.1契約を取得",
        responses: {
          "200": { description: "OpenAPI 3.1 document" },
        },
      },
    },
    "/api/dashboard": {
      get: {
        tags: ["catalog"],
        summary: "ダッシュボード集計を取得",
        responses: {
          "200": { description: "件数、カテゴリ別、提供元別、最近のデータソースを返す。ログ本体は管理者のみ含める" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/admin/session": {
      get: {
        tags: ["admin"],
        summary: "管理セッション状態を取得",
        responses: {
          "200": { description: "認証状態と管理セッションCookie有無を返す" },
        },
      },
      post: {
        tags: ["admin"],
        summary: "管理セッションを開始",
        responses: {
          "200": { description: "署名済みHttpOnly Cookieを発行" },
          "401": { description: "管理トークン不一致" },
          "403": { description: "CSRF Origin/Referer確認失敗" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定またはトークン強度不足" },
        },
      },
      delete: {
        tags: ["admin"],
        summary: "管理セッションを終了",
        responses: {
          "200": { description: "管理セッションCookieを削除" },
          "403": { description: "CSRF Origin/Referer確認失敗" },
        },
      },
    },
    "/api/admin/settings": {
      get: {
        tags: ["admin"],
        summary: "接続確認の動作設定を取得",
        responses: {
          "200": { description: "タイムアウト・リダイレクト上限・プレビュー保存上限・要確認期間を返す" },
          "429": { description: "レート制限超過" },
        },
      },
      put: {
        tags: ["admin"],
        summary: "接続確認の動作設定を変更",
        security: [{ adminToken: [] }],
        responses: {
          "200": { description: "保存成功。変更は監査ログへ記録される" },
          "400": { description: "設定キーまたは値が選択肢外" },
          "401": { description: "管理認証エラー" },
          "403": { description: "CSRF Origin/Referer確認失敗" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定" },
        },
      },
    },
    "/api/admin/audit-events": {
      post: {
        tags: ["admin"],
        summary: "クライアント操作の監査イベントを記録",
        security: [{ adminToken: [] }],
        responses: {
          "200": { description: "記録成功。内容はサーバー側のイベント種別写像で固定される" },
          "400": { description: "不明なイベント種別" },
          "401": { description: "管理認証エラー" },
          "403": { description: "CSRF Origin/Referer確認失敗" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定" },
        },
      },
    },
    "/api/tags": {
      get: {
        tags: ["catalog"],
        summary: "タグ一覧を取得",
        responses: {
          "200": { description: "タグ一覧と利用件数を返す" },
          "429": { description: "レート制限超過" },
        },
      },
      post: {
        tags: ["catalog"],
        summary: "タグを作成",
        security: [{ adminToken: [] }],
        responses: {
          "201": { description: "作成成功" },
          "400": { description: "入力不正" },
          "401": { description: "管理認証エラー" },
          "409": { description: "同名タグ重複" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定" },
        },
      },
    },
    "/api/tags/{id}": {
      delete: {
        tags: ["catalog"],
        summary: "タグを削除",
        security: [{ adminToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "削除成功" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定" },
        },
      },
    },
    "/api/sources": {
      get: {
        tags: ["catalog"],
        summary: "データソースを検索",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "providerId", in: "query", schema: { type: "string" } },
          { name: "dataFormat", in: "query", schema: { type: "string" } },
          { name: "requiresApiKey", in: "query", schema: { type: "boolean" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "tag", in: "query", schema: { type: "string" } },
          { name: "trustLevel", in: "query", schema: { type: "integer", minimum: 1, maximum: 5 } },
          { name: "take", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
          { name: "skip", in: "query", schema: { type: "integer", minimum: 0, maximum: 5000 } },
        ],
        responses: {
          "200": {
            description: "検索結果",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: sourceSummary },
                    total: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "検索条件が不正" },
          "429": { description: "レート制限超過" },
        },
      },
      post: {
        tags: ["catalog"],
        summary: "データソースを登録",
        security: [{ adminToken: [] }],
        responses: {
          "201": { description: "登録成功" },
          "400": { description: "入力不正" },
          "401": { description: "管理認証エラー" },
          "409": { description: "公式URL重複" },
          "503": { description: "本番管理認証が未設定" },
        },
      },
    },
    "/api/sources/{id}": {
      get: {
        tags: ["catalog"],
        summary: "データソース詳細を取得",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "データソース詳細" },
          "404": { description: "対象なし" },
        },
      },
      put: {
        tags: ["catalog"],
        summary: "データソースを更新",
        security: [{ adminToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "更新成功" },
          "400": { description: "入力不正" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "409": { description: "公式URL重複" },
        },
      },
      delete: {
        tags: ["catalog"],
        summary: "データソースを削除",
        security: [{ adminToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "削除成功" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
        },
      },
    },
    "/api/fetch-logs": {
      get: {
        tags: ["catalog"],
        summary: "取得ログを取得",
        security: [{ adminToken: [] }],
        responses: {
          "200": { description: "取得ログ一覧" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定" },
        },
      },
    },
    "/api/map/elevation": {
      get: {
        tags: ["catalog"],
        summary: "緯度経度から標高を取得",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
        ],
        responses: {
          "200": { description: "標高取得成功。X-CODIP-Cache に hit/miss を含む" },
          "400": { description: "緯度経度が不正" },
          "404": { description: "標高APIが台帳に未登録" },
          "429": { description: "レート制限超過" },
          "502": { description: "公開元API取得または解析失敗" },
        },
      },
    },
    "/api/v1/records/search": {
      get: {
        tags: ["downstream"],
        summary: "後続システム向け標準レコード検索",
        description:
          "MVPでは台帳メタデータを標準レコード形式へ投影して返す。標準化済み空間レコード本体はPostGIS連携フェーズで拡張する。",
        parameters: [
          { name: "q", in: "query", schema: { type: "string", minLength: 2 } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "updatedSince", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "共通メタデータ付き標準レコード形式の検索結果",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/V1RecordsSearchResponse" },
              },
            },
          },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/records/point": {
      get: {
        tags: ["downstream"],
        summary: "地点条件から候補レイヤーを取得",
        description:
          "MVPでは標準化済み地物が未投入のため、地点包含・周辺判定は実行せず、候補レイヤーとnot_standardized warningを返す。",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "lng", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
          { name: "radiusM", in: "query", schema: { type: "number", minimum: 1, maximum: 100000, default: 1000 } },
          {
            name: "categories",
            in: "query",
            description: "カンマ区切りカテゴリ。最大20件、各64文字以内。",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "地点条件と候補レイヤー一覧。MVPではrecordsは空配列",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/V1PointResponse" },
              },
            },
          },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/sources/{id}/freshness": {
      get: {
        tags: ["downstream"],
        summary: "データソース鮮度を取得",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "出典、品質状態、最終確認日時、最終成功日時、連続失敗数を返す",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/V1FreshnessResponse" },
              },
            },
          },
          "404": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/layers": {
      get: {
        tags: ["downstream"],
        summary: "後続システム向けレイヤー候補一覧を取得",
        description:
          "PostGIS standard_records が存在する環境では標準化済みレイヤーを返す。未投入環境ではGeoJSON/Shapefile/CityGML/タイル等の台帳メタデータをレイヤーカタログとして返す。",
        parameters: [
          { name: "q", in: "query", schema: { type: "string", minLength: 2 } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "レイヤー候補一覧",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/V1LayersResponse" },
              },
            },
          },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/layers/{id}/features": {
      get: {
        tags: ["downstream"],
        summary: "レイヤー地物をGeoJSON FeatureCollectionで取得",
        description:
          "PostGIS standard_records が存在する環境ではGeoJSON FeatureCollectionを返す。標準化済み地物が未投入の場合、空のFeatureCollectionと警告を返す。",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "bbox", in: "query", schema: { type: "string" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["geojson"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 5000 } },
          { name: "cursor", in: "query", schema: { type: "integer", minimum: 0, maximum: 100000 } },
        ],
        responses: {
          "200": {
            description: "GeoJSON FeatureCollection",
            content: {
              "application/geo+json": {
                schema: { $ref: "#/components/schemas/V1FeatureCollectionResponse" },
              },
              "application/json": {
                schema: { $ref: "#/components/schemas/V1FeatureCollectionResponse" },
              },
            },
          },
          "400": v1ErrorResponse,
          "404": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/sources/{id}/check": {
      post: {
        tags: ["catalog"],
        summary: "データソースの接続確認",
        security: [{ adminToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "接続確認結果" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/sources/{id}/fetch-sample": {
      post: {
        tags: ["catalog"],
        summary: "データソースのサンプル取得",
        security: [{ adminToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "サンプル取得結果。APIキー必須データの本文は保存しない" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/quality/{id}/recalculate": {
      post: {
        tags: ["quality"],
        summary: "品質スコアを再計算",
        security: [{ adminToken: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "再計算成功" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "429": { description: "レート制限超過" },
        },
      },
    },
  },
  components: {
    schemas: {
      V1ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              retryAfterSeconds: { type: "integer", minimum: 1 },
            },
          },
        },
      },
      V1Warning: {
        type: "object",
        required: ["code", "severity", "message"],
        properties: {
          code: { type: "string" },
          severity: { type: "string", enum: ["info", "warning"] },
          message: { type: "string" },
          mode: { type: "string" },
          sourceId: { type: "string" },
        },
      },
      V1Meta: {
        type: "object",
        required: ["requestId", "retrievedAt", "sourceCount"],
        properties: {
          requestId: { type: "string", pattern: "^req_" },
          retrievedAt: { type: "string", format: "date-time" },
          sourceCount: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 0 },
          nextCursor: { type: ["string", "null"] },
          mode: { type: "string" },
        },
      },
      V1StandardRecord: {
        type: "object",
        required: [
          "recordId",
          "sourceId",
          "sourceRecordId",
          "category",
          "title",
          "geometry",
          "retrievedAt",
          "sourceUrl",
          "licenseId",
          "qualityStatus",
          "properties",
        ],
        properties: {
          recordId: { type: "string" },
          sourceId: { type: "string" },
          sourceRecordId: { type: "string" },
          category: { type: "string" },
          title: { type: "string" },
          description: { type: ["string", "null"] },
          prefectureCode: { type: ["string", "null"] },
          municipalityCode: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          geometry: { type: ["object", "null"] },
          observedAt: { type: ["string", "null"], format: "date-time" },
          publishedAt: { type: ["string", "null"], format: "date-time" },
          retrievedAt: { type: "string", format: "date-time" },
          validFrom: { type: ["string", "null"], format: "date-time" },
          validTo: { type: ["string", "null"], format: "date-time" },
          sourceUrl: { type: "string", format: "uri" },
          licenseId: { type: ["string", "null"] },
          qualityStatus: { type: "string" },
          rawDataReference: { type: ["string", "null"] },
          properties: { type: "object" },
        },
      },
      V1RecordsSearchResponse: {
        type: "object",
        required: ["data", "meta", "warnings"],
        properties: {
          data: {
            type: "object",
            required: ["records"],
            properties: {
              records: { type: "array", items: { $ref: "#/components/schemas/V1StandardRecord" } },
            },
          },
          meta: { $ref: "#/components/schemas/V1Meta" },
          warnings: v1Warnings,
        },
      },
      V1PointResponse: {
        type: "object",
        required: ["data", "meta", "warnings"],
        properties: {
          data: {
            type: "object",
            required: ["point", "records", "candidateLayers", "spatialEvaluation"],
            properties: {
              point: { type: "object" },
              records: { type: "array" },
              candidateLayers: { type: "array", items: { type: "object" } },
              spatialEvaluation: { type: "object" },
              dataAvailability: { type: "string" },
              geometryStatus: { type: "string" },
            },
          },
          meta: { $ref: "#/components/schemas/V1Meta" },
          warnings: v1Warnings,
        },
      },
      V1FreshnessResponse: {
        type: "object",
        required: ["data", "meta", "warnings"],
        properties: {
          data: { type: "object" },
          meta: { $ref: "#/components/schemas/V1Meta" },
          warnings: v1Warnings,
        },
      },
      V1LayersResponse: {
        type: "object",
        required: ["data", "meta", "warnings"],
        properties: {
          data: {
            type: "object",
            required: ["layers"],
            properties: {
              layers: { type: "array", items: { type: "object" } },
            },
          },
          meta: { $ref: "#/components/schemas/V1Meta" },
          warnings: v1Warnings,
        },
      },
      V1FeatureCollectionResponse: {
        type: "object",
        required: ["type", "features", "metadata", "warnings"],
        properties: {
          type: { type: "string", const: "FeatureCollection" },
          features: { type: "array" },
          metadata: { type: "object" },
          warnings: v1Warnings,
        },
      },
    },
    securitySchemes: {
      adminToken: {
        type: "apiKey",
        in: "header",
        name: "x-codip-admin-token",
        description: "APIクライアント用。CODIP_ADMIN_TOKEN と同じ値。Bearer認証も利用可能。ブラウザUIは署名済みHttpOnly Cookieを利用し、変更系操作では同一Origin確認を行う。",
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(openApiDocument);
}
