import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { runIngestionJob } from "@/lib/ingestion/engine";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:run", clientIdentifier(request), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const { id } = await params;

  const job = await prisma.ingestionJob.findUnique({ where: { id }, include: { dataSource: true } });
  if (!job) {
    return NextResponse.json({ error: "not_found", message: "定期収集ジョブが見つかりません" }, { status: 404 });
  }
  try {
    const result = await runIngestionJob(prisma, { jobId: id, triggeredBy: "manual" });
    await recordAudit({
      action: "定期収集ジョブ手動実行",
      target: job.name,
      detail: `status=${result.status}, inserted=${result.inserted}, updated=${result.updated}, skipped=${result.skipped}`,
      level: result.status === "success" ? "success" : "warning",
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAudit({ action: "定期収集ジョブ手動実行失敗", target: job.name, detail: message, level: "danger" });
    return NextResponse.json({ error: "ingestion_failed", message }, { status: 500 });
  }
}
