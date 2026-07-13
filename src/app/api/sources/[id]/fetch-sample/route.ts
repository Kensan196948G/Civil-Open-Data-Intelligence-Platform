import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { PREVIEW_MAX_BYTES } from "@/lib/constants";
import { sanitizeUrl } from "@/lib/http-client";
import { redactOperationalText } from "@/lib/operational-dto";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { findConnector } from "@/connectors/registry";
import { targetUrlOf } from "@/connectors/types";

type RouteContext = { params: Promise<{ id: string }> };

/** サンプル取得: コネクタ経由で取得し、プレビューと形式判定結果を保存する */
export async function POST(request: NextRequest, context: RouteContext) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  const source = await prisma.dataSource.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rate = checkRateLimit(
    `source-sample:${source.id}`,
    clientIdentifier(request),
    6,
    60_000,
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const connector = findConnector(source);
  const result = await connector.fetchSample(source);
  const errorMessage = result.errorMessage
    ? redactOperationalText(result.errorMessage)
    : null;

  const detectedFormat = result.detectedFormat ?? null;
  const now = new Date();
  const { log, sampleId } = await prisma.$transaction(async (tx) => {
    const log = await tx.fetchLog.create({
      data: {
        dataSourceId: source.id,
        executionType: "sample",
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
    });

    let sampleId: string | null = null;
    if (result.success && !source.requiresApiKey) {
      const preview = redactOperationalText(result.previewText ?? "", PREVIEW_MAX_BYTES);
      const sample = await tx.sampleResponse.create({
        data: {
          dataSourceId: source.id,
          fetchLogId: log.id,
          previewText: preview,
          detectedFormat,
        },
      });
      sampleId = sample.id;
    }

    await tx.dataSource.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: now,
        status: result.success ? "active" : "unstable",
      },
    });

    return { log, sampleId };
  });

  return NextResponse.json({
    success: result.success,
    statusCode: result.statusCode ?? null,
    responseTimeMs: result.responseTimeMs ?? null,
    contentType: result.contentType ?? null,
    responseSizeBytes: result.responseSizeBytes ?? null,
    detectedFormat,
    sampleId,
    sampleStored: Boolean(sampleId),
    connector: connector.name,
    errorType: result.errorType ?? null,
    message:
      errorMessage ??
      (result.success && source.requiresApiKey
        ? "APIキーが必要なデータソースのためサンプル本文は保存していません"
        : null),
    logId: log.id,
  });
}
