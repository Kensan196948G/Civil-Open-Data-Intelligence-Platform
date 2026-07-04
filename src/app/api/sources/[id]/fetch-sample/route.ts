import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PREVIEW_MAX_BYTES } from "@/lib/constants";
import { detectFormat } from "@/lib/format-detector";
import { fetchWithGuard, sanitizeUrl } from "@/lib/http-client";

type RouteContext = { params: Promise<{ id: string }> };

/** サンプル取得: レスポンス先頭プレビューと形式判定結果を保存する */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const source = await prisma.dataSource.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const targetUrl = source.endpointUrl ?? source.officialUrl;
  const result = await fetchWithGuard(targetUrl, { method: "GET", readBody: true });

  const log = await prisma.fetchLog.create({
    data: {
      dataSourceId: source.id,
      executionType: "sample",
      requestUrl: sanitizeUrl(targetUrl),
      method: "GET",
      statusCode: result.statusCode ?? null,
      success: result.success,
      responseTimeMs: result.responseTimeMs ?? null,
      responseSizeBytes: result.responseSizeBytes ?? null,
      contentType: result.contentType ?? null,
      errorType: result.errorType ?? null,
      errorMessage: result.errorMessage ?? null,
    },
  });

  let sampleId: string | null = null;
  let detectedFormat: string | null = null;
  if (result.success) {
    const preview = (result.previewText ?? "").slice(0, PREVIEW_MAX_BYTES);
    detectedFormat = detectFormat(result.contentType ?? null, preview);
    const sample = await prisma.sampleResponse.create({
      data: {
        dataSourceId: source.id,
        fetchLogId: log.id,
        previewText: preview,
        detectedFormat,
      },
    });
    sampleId = sample.id;
  }

  await prisma.dataSource.update({
    where: { id: source.id },
    data: {
      lastCheckedAt: new Date(),
      status: result.success ? "active" : "unstable",
    },
  });

  return NextResponse.json({
    success: result.success,
    statusCode: result.statusCode ?? null,
    responseTimeMs: result.responseTimeMs ?? null,
    contentType: result.contentType ?? null,
    responseSizeBytes: result.responseSizeBytes ?? null,
    detectedFormat,
    sampleId,
    errorType: result.errorType ?? null,
    message: result.errorMessage ?? null,
    logId: log.id,
  });
}
