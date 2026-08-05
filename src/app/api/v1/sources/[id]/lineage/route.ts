import { NextRequest, NextResponse } from "next/server";
import { PrismaClient as PostgreSQLPrismaClient } from ".prisma/client-postgresql";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { requestId, v1RateLimitResponse } from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

type Params = { params: Promise<{ id: string }> };

const pg = prisma as unknown as PostgreSQLPrismaClient;

export async function GET(request: NextRequest, { params }: Params) {
  const rate = checkRateLimit("api:v1:lineage", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);
  const { id } = await params;

  const source = await pg.dataSource.findUnique({
    where: { id },
    include: {
      ingestionJob: true,
      standardRecords: { select: { id: true, ingestionRunId: true, updatedAt: true } },
      provider: { select: { id: true, name: true } },
    },
  });
  if (!source) {
    return NextResponse.json({ error: { code: "not_found", message: "データソースが見つかりません" } }, { status: 404 });
  }

  const runs = await pg.ingestionRun.findMany({
    where: { ingestionJobId: source.ingestionJob?.id ?? "__none__" },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    data: {
      source: {
        id: source.id,
        name: source.name,
        category: source.category,
        provider: source.provider,
        officialUrl: sanitizeUrl(source.officialUrl),
        endpointUrl: source.endpointUrl ? sanitizeUrl(source.endpointUrl) : null,
        standardRecordCount: source.standardRecords.length,
      },
      ingestionJob: source.ingestionJob
        ? {
            id: source.ingestionJob.id,
            name: source.ingestionJob.name,
            enabled: source.ingestionJob.enabled,
            intervalMinutes: source.ingestionJob.intervalMinutes,
            maxRecords: source.ingestionJob.maxRecords,
            etag: source.ingestionJob.etag ? "(set)" : null,
            lastModified: source.ingestionJob.lastModified ? "(set)" : null,
            lastRunAt: source.ingestionJob.lastRunAt,
            nextRunAt: source.ingestionJob.nextRunAt,
            lastStatus: source.ingestionJob.lastStatus,
          }
        : null,
      lineage: runs.map((run) => ({
        runId: run.id,
        status: run.status,
        triggeredBy: run.triggeredBy,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        statusCode: run.statusCode,
        recordsInserted: run.recordsInserted,
        recordsUpdated: run.recordsUpdated,
        recordsSkipped: run.recordsSkipped,
        errorType: run.errorType,
        errorMessage: run.errorMessage,
        note: run.note,
      })),
    },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      mode: "data_lineage",
    },
  });
}
