import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizeUrl } from "@/lib/http-client";
import { findConnector } from "@/connectors/registry";
import { targetUrlOf } from "@/connectors/types";

type RouteContext = { params: Promise<{ id: string }> };

/** 接続確認: データソースに対応するコネクタで疎通確認し fetch_logs に記録する */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const source = await prisma.dataSource.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const connector = findConnector(source);
  const result = await connector.check(source);

  const log = await prisma.fetchLog.create({
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
      errorMessage: result.errorMessage ?? null,
      note: `connector: ${connector.name}`,
    },
  });

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
    connector: connector.name,
    errorType: result.errorType ?? null,
    message: result.errorMessage ?? null,
    logId: log.id,
  });
}
