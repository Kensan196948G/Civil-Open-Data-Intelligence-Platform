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
  } catch (error) {
    // 監視(production-smoke)は応答本文しか観測できないため、失敗の実体
    // (接続先・認証・タイムアウト等) はここでログへ落として初めて
    // Cloudflare Workers Logs / wrangler tail で確認できる。
    console.error("[ready] database readiness check failed", error);
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
