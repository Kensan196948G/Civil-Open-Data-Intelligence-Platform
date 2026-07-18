-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "audit_logs_occurredAt_idx" ON "audit_logs"("occurredAt");

-- Backfill: 既存の取得ログ (fetch_logs) を監査イベントへ写像して移行する。
-- 監査ログ画面はこれまで FetchLog から導出表示していたため、表示内容の非退行を保証する。
INSERT INTO "audit_logs" ("id", "actor", "action", "target", "detail", "level", "occurredAt")
SELECT
  'aud_' || md5(f."id" || clock_timestamp()::text),
  'システム',
  CASE
    WHEN f."executionType" = 'sample' THEN 'サンプル取得実行'
    WHEN f."success" THEN '接続確認実行'
    ELSE '接続失敗検知'
  END,
  COALESCE(d."name", '-'),
  CASE
    WHEN f."success" AND f."executionType" = 'sample' THEN 'サンプルデータを取得'
    WHEN f."success" THEN '疎通確認 成功'
    ELSE COALESCE(
      CASE f."errorType"
        WHEN 'timeout' THEN '接続がタイムアウトしました'
        WHEN 'network' THEN 'ネットワーク接続に失敗しました'
        WHEN 'invalid_url' THEN 'URL形式が正しくありません'
        WHEN 'auth_required' THEN 'APIキーまたは認証が必要です'
        WHEN 'parse_error' THEN 'レスポンス形式を判定できませんでした'
        WHEN 'rate_limited' THEN 'アクセス制限の可能性があります'
        WHEN 'blocked_url' THEN '取得が許可されていないURLです'
        WHEN 'unknown' THEN '不明なエラーが発生しました'
        ELSE f."errorType"
      END,
      '詳細不明のエラー')
  END,
  CASE WHEN f."success" THEN 'success' ELSE 'danger' END,
  f."executedAt"
FROM "fetch_logs" f
LEFT JOIN "data_sources" d ON d."id" = f."dataSourceId";
