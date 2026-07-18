import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = performance.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ready",
      service: "civil-open-data-intelligence-platform",
      checks: {
        database: "ok",
      },
      responseTimeMs: Math.round(performance.now() - startedAt),
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        status: "not_ready",
        service: "civil-open-data-intelligence-platform",
        checks: {
          database: "error",
        },
        error: "readiness_dependency_failed",
        responseTimeMs: Math.round(performance.now() - startedAt),
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
