import { NextResponse } from "next/server";
import { rateLimitHeaders, type RateLimitResult } from "@/lib/rate-limit";

export type V1Warning = {
  code: string;
  severity: "info" | "warning";
  message: string;
  mode?: string;
  sourceId?: string;
};

export function requestId() {
  return `req_${crypto.randomUUID()}`;
}

export function qualityStatus(input: { status: string; qualityScore: number; lastCheckedAt: Date | null }) {
  if (input.status === "deprecated") return "deprecated";
  if (input.status === "active" && input.qualityScore >= 80) return "usable";
  if (!input.lastCheckedAt) return "unverified";
  return "needs_review";
}

export function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function v1Error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function v1RateLimitResponse(result: RateLimitResult) {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: {
        code: "rate_limited",
        message: "短時間のアクセス回数が上限を超えました。少し待ってから再実行してください。",
        retryAfterSeconds,
      },
    },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}

export const decisionNotSupportedWarning: V1Warning = {
  code: "decision_not_supported",
  severity: "warning",
  message: "施工可否・安全性・法令適合の最終判断には使用しないでください。",
};

export function catalogMetadataWarning(mode: string): V1Warning {
  return {
    code: "catalog_metadata_only",
    severity: "info",
    message: "現行MVPは標準レコード本体ではなく、台帳メタデータを標準形式へ投影しています。",
    mode,
  };
}
