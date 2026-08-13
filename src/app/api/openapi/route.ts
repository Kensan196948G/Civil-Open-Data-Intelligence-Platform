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

const adminSecurity = [{ adminToken: [] }, { adminSession: [] }, { adminProxy: [] }] as const;

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
        security: adminSecurity,
        responses: {
          "200": { description: "タイムアウト・リダイレクト上限・プレビュー保存上限・要確認期間を返す" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
          "503": { description: "管理ガード未設定" },
        },
      },
      put: {
        tags: ["admin"],
        summary: "接続確認の動作設定を変更",
        security: adminSecurity,
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
        security: adminSecurity,
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
    "/api/admin/roles": {
      get: {
        tags: ["admin"],
        summary: "RBACロール一覧と有効な割当を取得",
        security: adminSecurity,
        responses: {
          "200": { description: "ロール一覧と割当一覧" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
        },
      },
      post: {
        tags: ["admin"],
        summary: "ユーザーへロールを割当（監査ログ記録）",
        security: adminSecurity,
        responses: {
          "201": { description: "割当成功" },
          "400": { description: "入力不正（メール形式・未知ロール・scope形式）" },
          "401": { description: "管理認証エラー" },
          "409": { description: "有効な割当が既に存在、またはロール未シード" },
          "422": { description: "expiresAt が不正な日付" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/admin/roles/{id}": {
      delete: {
        tags: ["admin"],
        summary: "ロール割当を失効させる（監査ログ記録）",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
            description: "RoleAssignment ID",
          },
        ],
        security: adminSecurity,
        responses: {
          "200": { description: "失効成功" },
          "401": { description: "管理認証エラー" },
          "404": { description: "割当が見つからない、または既に失効" },
          "429": { description: "レート制限超過" },
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
        security: adminSecurity,
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
        security: adminSecurity,
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
        security: adminSecurity,
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
        security: adminSecurity,
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
        security: adminSecurity,
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
        security: adminSecurity,
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
    "/api/v1/terrain/elevation": {
      get: {
        tags: ["downstream"],
        summary: "地点標高取得 (GSI DEMタイル)",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
        ],
        responses: {
          "200": { description: "標高・出典・品質を返す" },
          "400": v1ErrorResponse,
          "404": { description: "対象地点に標高データがない (データなし≠安全)" },
          "429": v1ErrorResponse,
          "503": { description: "上流取得失敗 (判定不能)" },
        },
      },
    },
    "/api/v1/terrain/analysis": {
      get: {
        tags: ["downstream"],
        summary: "周辺グリッドの傾斜統計・地形分類 (Horn法/TPI)",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
        ],
        responses: {
          "200": { description: "傾斜統計・地形分類・品質・出典を返す" },
          "400": v1ErrorResponse,
          "404": { description: "DEMデータなし" },
          "429": v1ErrorResponse,
          "503": { description: "上流取得失敗" },
        },
      },
    },
    "/api/v1/terrain/section": {
      get: {
        tags: ["downstream"],
        summary: "任意線の断面分析 (縦断プロファイル・勾配統計)",
        parameters: [
          { name: "startLat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "startLon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
          { name: "endLat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "endLon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
        ],
        responses: {
          "200": { description: "断面サンプル・統計を返す" },
          "400": v1ErrorResponse,
          "404": { description: "DEMデータなし" },
          "413": { description: "断面が長すぎる" },
          "422": { description: "断面が短すぎる" },
          "429": v1ErrorResponse,
          "503": { description: "上流取得失敗" },
        },
      },
    },
    "/api/v1/terrain/confirm": {
      get: {
        tags: ["downstream"],
        summary: "確認支援カード (根拠付き・総合危険度なし)",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
        ],
        responses: {
          "200": { description: "確認支援カード一覧を返す" },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/terrain/export": {
      get: {
        tags: ["downstream"],
        summary: "地形分析レポート出力 (Markdown/CSV/JSON)",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number", minimum: -90, maximum: 90 } },
          { name: "lon", in: "query", required: true, schema: { type: "number", minimum: -180, maximum: 180 } },
          { name: "format", in: "query", schema: { type: "string", enum: ["markdown", "csv", "json"] } },
        ],
        responses: {
          "200": { description: "レポート本文 (添付ダウンロード)" },
          "400": v1ErrorResponse,
          "404": { description: "DEMデータなし" },
          "429": v1ErrorResponse,
          "503": { description: "上流取得失敗" },
        },
      },
    },
    "/api/v1/terrain/runs": {
      get: {
        tags: ["downstream"],
        summary: "保存済み地形案件一覧",
        responses: { "200": { description: "案件一覧" }, "429": v1ErrorResponse },
      },
      post: {
        tags: ["downstream"],
        summary: "地形案件保存 (管理認証必須)",
        responses: { "201": { description: "保存結果" }, "400": v1ErrorResponse, "401": v1ErrorResponse },
      },
    },
    "/api/v1/weather/forecast": {
      get: {
        tags: ["downstream"],
        summary: "週間予報 (Open-Meteo 参考情報)",
        parameters: [
          { name: "lat", in: "query", required: true, schema: { type: "number" } },
          { name: "lon", in: "query", required: true, schema: { type: "number" } },
        ],
        responses: { "200": { description: "7日間予報" }, "400": v1ErrorResponse, "429": v1ErrorResponse, "503": v1ErrorResponse },
      },
    },
    "/api/v1/weather/ai-analysis": {
      get: {
        tags: ["downstream"],
        summary: "AI参考解説 (ルールベース・参考情報)",
        responses: { "200": { description: "日本語解説" }, "400": v1ErrorResponse, "404": v1ErrorResponse, "429": v1ErrorResponse },
      },
    },
    "/api/v1/sites": {
      get: {
        tags: ["downstream"],
        summary: "現場一覧取得",
        responses: { "200": { description: "現場一覧" }, "429": v1ErrorResponse },
      },
      post: {
        tags: ["downstream"],
        summary: "現場登録 (管理認証必須)",
        responses: { "201": { description: "登録結果" }, "400": v1ErrorResponse, "401": v1ErrorResponse, "409": v1ErrorResponse },
      },
    },
    "/api/v1/thresholds": {
      get: {
        tags: ["downstream"],
        summary: "閾値一覧 (siteId指定時はグローバルも含む)",
        responses: { "200": { description: "閾値一覧" }, "429": v1ErrorResponse },
      },
      post: {
        tags: ["downstream"],
        summary: "閾値登録 (管理認証必須)",
        responses: { "201": { description: "登録結果" }, "400": v1ErrorResponse, "401": v1ErrorResponse },
      },
    },
    "/api/v1/thresholds/{id}": {
      patch: {
        tags: ["downstream"],
        summary: "閾値更新 (管理認証必須)",
        responses: { "200": { description: "更新結果" }, "400": v1ErrorResponse, "401": v1ErrorResponse, "404": v1ErrorResponse },
      },
      delete: {
        tags: ["downstream"],
        summary: "閾値削除 (管理認証必須)",
        responses: { "204": { description: "削除成功" }, "401": v1ErrorResponse, "404": v1ErrorResponse },
      },
    },
    "/api/v1/observations/weather": {
      get: {
        tags: ["downstream"],
        summary: "気象観測一覧 (siteId/t0/t1/limit)",
        responses: { "200": { description: "観測一覧" }, "400": v1ErrorResponse, "429": v1ErrorResponse },
      },
      post: {
        tags: ["downstream"],
        summary: "気象観測取り込み (管理認証必須・upsert)",
        responses: { "201": { description: "取り込み結果" }, "400": v1ErrorResponse, "401": v1ErrorResponse },
      },
    },
    "/api/v1/observations/weather/latest": {
      get: {
        tags: ["downstream"],
        summary: "最新気象観測",
        responses: { "200": { description: "最新値" }, "404": v1ErrorResponse },
      },
    },
    "/api/v1/observations/marine": {
      get: {
        tags: ["downstream"],
        summary: "海象観測一覧",
        responses: { "200": { description: "観測一覧" }, "400": v1ErrorResponse, "429": v1ErrorResponse },
      },
      post: {
        tags: ["downstream"],
        summary: "海象観測取り込み (管理認証必須・upsert)",
        responses: { "201": { description: "取り込み結果" }, "400": v1ErrorResponse, "401": v1ErrorResponse },
      },
    },
    "/api/v1/observations/marine/latest": {
      get: {
        tags: ["downstream"],
        summary: "最新海象観測",
        responses: { "200": { description: "最新値" }, "404": v1ErrorResponse },
      },
    },
    "/api/v1/decisions": {
      post: {
        tags: ["downstream"],
        summary: "施工可否判定 (go/caution/stop, 管理認証必須)",
        responses: { "200": { description: "判定結果 + 監査スナップショット" }, "400": v1ErrorResponse, "401": v1ErrorResponse, "404": v1ErrorResponse },
      },
    },
    "/api/v1/analysis/historical": {
      get: {
        tags: ["downstream"],
        summary: "月次履歴統計",
        responses: { "200": { description: "月次集計" }, "400": v1ErrorResponse, "429": v1ErrorResponse },
      },
    },
    "/api/v1/analysis/wave50": {
      get: {
        tags: ["downstream"],
        summary: "50年確率波推算 (Gumbel/Weibull)",
        responses: { "200": { description: "再現期間ごとの波高" }, "400": v1ErrorResponse, "422": v1ErrorResponse, "429": v1ErrorResponse },
      },
    },
    "/api/v1/etl/status": {
      get: {
        tags: ["downstream"],
        summary: "ETLジョブ状態",
        responses: { "200": { description: "ジョブ状態" }, "429": v1ErrorResponse },
      },
    },
    "/api/v1/etl/run/{id}": {
      post: {
        tags: ["downstream"],
        summary: "ETL手動実行 (Node環境のみ。Workersではworkflow_dispatch)",
        responses: { "200": { description: "実行結果" }, "401": v1ErrorResponse, "404": v1ErrorResponse, "501": v1ErrorResponse },
      },
    },
    "/api/v1/reports": {
      post: {
        tags: ["downstream"],
        summary: "レポート出力 (CSV/Markdown, 管理認証必須)",
        responses: { "200": { description: "レポート本文" }, "400": v1ErrorResponse, "401": v1ErrorResponse, "422": v1ErrorResponse },
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
          { name: "q", in: "query", schema: { type: "string", minLength: 2 } },
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
    "/api/v1/assessments/point": {
      get: {
        tags: ["downstream"],
        summary: "地点横断評価（カテゴリ別サマリー）を取得",
        description:
          "PostGIS standard_records が存在する環境では、指定地点の半径内にある標準レコードをカテゴリ・レイヤー別に集計して返す。未投入環境では候補レイヤーとnot_standardized warningを返す。",
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
          "200": { description: "地点横断サマリー（カテゴリ別件数・レイヤー別件数・最短距離）" },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/recommendations": {
      get: {
        tags: ["downstream"],
        summary: "ルールベースのデータソース推薦（AIコンシェルジュ）",
        description:
          "キーワード・カテゴリ・タグ・品質・利用シーンからデータソースをスコアリングし、推薦理由付きで返す。LLM/RAG導入前のMVP実装。",
        parameters: [
          { name: "query", in: "query", required: true, schema: { type: "string", minLength: 2 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 20, default: 5 } },
        ],
        responses: {
          "200": { description: "推薦データソース一覧（スコア・理由・地図レイヤーURL付き）" },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/watchlist": {
      get: {
        tags: ["downstream"],
        summary: "自分のウォッチリスト登録一覧を取得（無効含む / engineer以上）",
        security: adminSecurity,
        responses: {
          "200": { description: "ウォッチリスト登録一覧（identity と entries）" },
          "401": { description: "管理認証エラーまたは識別ヘッダー不足" },
          "429": v1ErrorResponse,
        },
      },
      post: {
        tags: ["downstream"],
        summary: "ウォッチリストへ登録（site / dataSource / ingestionJob）",
        security: adminSecurity,
        responses: {
          "201": { description: "登録成功" },
          "400": v1ErrorResponse,
          "401": { description: "管理認証エラーまたは識別ヘッダー不足" },
          "409": { description: "既に登録済み" },
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/watchlist/{id}": {
      delete: {
        tags: ["downstream"],
        summary: "自分のウォッチリスト登録を解除",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
        ],
        security: adminSecurity,
        responses: {
          "200": { description: "解除成功" },
          "401": { description: "管理認証エラーまたは識別ヘッダー不足" },
          "404": { description: "登録が見つからない" },
          "429": v1ErrorResponse,
        },
      },
      patch: {
        tags: ["downstream"],
        summary: "自分のウォッチリスト登録の有効/無効を切り替え",
        parameters: [
          { in: "path", name: "id", required: true, schema: { type: "string" } },
        ],
        security: adminSecurity,
        responses: {
          "200": { description: "更新成功" },
          "400": v1ErrorResponse,
          "401": { description: "管理認証エラーまたは識別ヘッダー不足" },
          "404": { description: "登録が見つからない" },
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/sources/{id}/lineage": {
      get: {
        tags: ["downstream"],
        summary: "データリネージュ（取得ジョブ・実行履歴・標準レコード件数）を取得",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "出典→定期収集ジョブ→実行履歴→標準レコードの追跡情報" },
          "404": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/v1/assessments/geometry": {
      post: {
        tags: ["downstream"],
        summary: "ジオメトリ空間評価（circle/bbox/polygon・バッファ・交差・最近傍）を取得",
        description:
          "PostGIS standard_records に対し、円・矩形・ポリゴンの空間条件＋バッファ＋キーワードで検索し、カテゴリ/レイヤー別集計とレコードを返す。未投入環境では候補レイヤーを返す。",
        responses: {
          "200": { description: "空間評価結果" },
          "400": v1ErrorResponse,
          "429": v1ErrorResponse,
        },
      },
    },
    "/api/admin/ingestion/jobs": {
      get: {
        tags: ["admin"],
        summary: "定期収集ジョブ一覧を取得",
        security: adminSecurity,
        responses: {
          "200": { description: "定期収集ジョブ一覧（直近5実行履歴付き）" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
        },
      },
      post: {
        tags: ["admin"],
        summary: "定期収集ジョブを作成",
        security: adminSecurity,
        responses: {
          "201": { description: "作成成功" },
          "400": { description: "入力不正" },
          "401": { description: "管理認証エラー" },
          "404": { description: "データソースなし" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/admin/ingestion/jobs/{id}": {
      patch: {
        tags: ["admin"],
        summary: "定期収集ジョブを更新",
        security: adminSecurity,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "更新成功" },
          "400": { description: "入力不正" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
        },
      },
      delete: {
        tags: ["admin"],
        summary: "定期収集ジョブを削除",
        security: adminSecurity,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "削除成功" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/admin/ingestion/jobs/{id}/run": {
      post: {
        tags: ["admin"],
        summary: "定期収集ジョブを手動実行",
        security: adminSecurity,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "実行結果（挿入・更新・スキップ件数）" },
          "401": { description: "管理認証エラー" },
          "404": { description: "対象なし" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/admin/ingestion/runs": {
      get: {
        tags: ["admin"],
        summary: "定期収集実行履歴を取得",
        security: adminSecurity,
        responses: {
          "200": { description: "実行履歴一覧" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/admin/ingestion/quality-summary": {
      get: {
        tags: ["admin"],
        summary: "データ品質監視サマリーを取得",
        security: adminSecurity,
        responses: {
          "200": { description: "実行ステータス件数・デッドレター・スキーマ変化・停滞ジョブ・件数異常" },
          "401": { description: "管理認証エラー" },
          "429": { description: "レート制限超過" },
        },
      },
    },
    "/api/sources/{id}/check": {
      post: {
        tags: ["catalog"],
        summary: "データソースの接続確認",
        security: adminSecurity,
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
        security: adminSecurity,
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
        security: adminSecurity,
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
      adminSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-codip_admin_session",
        description: "ブラウザUI用の署名済みHttpOnly管理セッションCookie。HTTPローカルでは codip_admin_session を利用する。",
      },
      adminProxy: {
        type: "apiKey",
        in: "header",
        name: "x-codip-proxy-secret",
        description: "Cloudflare Access identity header と組み合わせるプロキシ認証用共有secret。値はSecretsで管理する。",
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(openApiDocument);
}
