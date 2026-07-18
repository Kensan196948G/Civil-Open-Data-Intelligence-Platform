import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { recordAudit } from "@/lib/audit";
import { ERROR_TYPE_MESSAGES } from "@/lib/constants";
import { sanitizeUrl } from "@/lib/http-client";
import { redactOperationalText } from "@/lib/operational-dto";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { findConnector } from "@/connectors/registry";
import { targetUrlOf } from "@/connectors/types";

type RouteContext = { params: Promise<{ id: string }> };

/** 接続確認: データソースに対応するコネクタで疎通確認し fetch_logs に記録する */
export async function POST(request: NextRequest, context: RouteContext) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  const source = await prisma.dataSource.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rate = checkRateLimit(
    `source-check:${source.id}`,
    clientIdentifier(request),
    12,
    60_000,
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const connector = findConnector(source);
  const result = await connector.check(source);
  const errorMessage = result.errorMessage
    ? redactOperationalText(result.errorMessage)
    : null;

  const now = new Date();
  const [log] = await prisma.$transaction([
    prisma.fetchLog.create({
      data: {
        dataSourceId: source.id,
        executionType: "check",
        requestUrl: sanitizeUrl(result.finalUrl ?? targetUrlOf(source)),
        method: "GET",
        statusCode: result.statusCode ?? null,
        success: result.success,
        responseTimeMs: result.responseTimeMs ?? null,
        responseSizeBytes: result.responseSizeBytes ?? null,
        contentType: result.contentType ?? null,
        errorType: result.errorType ?? null,
        errorMessage,
        note: `connector: ${connector.name}`,
      },
    }),
    prisma.dataSource.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: now,
        status: result.success ? "active" : "unstable",
      },
    }),
  ]);

  // 失敗時は backfill (migration) と同じ分類 (接続失敗検知 + エラー種別詳細) を使い、
  // 生成時期によって audit_logs の action ラベルが割れないようにする
  await recordAudit({
    action: result.success ? "接続確認実行" : "接続失敗検知",
    target: source.name,
    detail: result.success
      ? "疎通確認 成功"
      : (ERROR_TYPE_MESSAGES[result.errorType ?? "unknown"] ?? "疎通確認 失敗"),
    level: result.success ? "success" : "danger",
  });

  return NextResponse.json({
    success: result.success,
    statusCode: result.statusCode ?? null,
    responseTimeMs: result.responseTimeMs ?? null,
    contentType: result.contentType ?? null,
    responseSizeBytes: result.responseSizeBytes ?? null,
    connector: connector.name,
    errorType: result.errorType ?? null,
    message: errorMessage,
    logId: log.id,
  });
}
