import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

const VALID_JOBS = new Set(["1", "2"]);
const RUN_TIMEOUT_MS = 120_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:etl:run", clientIdentifier(request), 3, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const { id } = await params;
  if (!VALID_JOBS.has(id)) {
    return NextResponse.json({ error: { code: "invalid_query", message: "job_id は 1 (AMeDAS) / 2 (Marine) です" } }, { status: 404 });
  }

  if (!process.versions?.node) {
    return NextResponse.json(
      {
        error: {
          code: "unsupported_runtime",
          message: "Cloudflare Workers では取り込みジョブを直接実行できません。GitHub Actions の Weather-Marine Data Ingestion ワークフロー (workflow_dispatch) を実行してください。",
        },
      },
      { status: 501 },
    );
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["scripts/ingestion/run-weather-jobs.js"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "" },
        timeout: RUN_TIMEOUT_MS,
      },
    );
    await prisma.auditLog.create({
      data: auditLogCreateData({ action: "ETL手動実行", target: `job:${id}`, detail: stdout || stderr, level: "success" }),
    });
    return NextResponse.json({ data: { status: "finished", jobId: id, output: (stdout || stderr).trim() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.auditLog.create({
      data: auditLogCreateData({ action: "ETL手動実行", target: `job:${id}`, detail: message, level: "danger" }),
    });
    return NextResponse.json({ error: { code: "etl_run_failed", message } }, { status: 500 });
  }
}
