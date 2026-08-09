import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId } from "@/lib/v1-response";
import { evaluateDecision, isRuleInEffect } from "@/lib/decision/engine";
import type { ThresholdRule } from "@/lib/decision/engine";

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:decisions:write", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const siteId = typeof body?.siteId === "string" ? body.siteId : "";
  const workType = typeof body?.workType === "string" ? body.workType : "";
  const windowStart = body?.targetWindowStart ? new Date(body.targetWindowStart) : null;
  const windowEnd = body?.targetWindowEnd ? new Date(body.targetWindowEnd) : null;
  if (!siteId || !workType || !windowStart || !windowEnd || Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "siteId/workType/targetWindowStart/targetWindowEnd を確認してください" } },
      { status: 400 },
    );
  }
  if (windowEnd.getTime() <= windowStart.getTime()) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "targetWindowEnd must be after targetWindowStart" } },
      { status: 400 },
    );
  }
  const site = await prisma.constructionSite.findUnique({ where: { id: siteId } });
  if (!site) {
    return NextResponse.json({ error: { code: "not_found", message: "現場が見つかりません" } }, { status: 404 });
  }

  const rows = await prisma.weatherThreshold.findMany({
    where: { workType, OR: [{ siteId }, { siteId: null }] },
  });
  const rules: ThresholdRule[] = [];
  const outOfEffect: Record<string, unknown>[] = [];
  for (const row of rows) {
    const rule: ThresholdRule = {
      workType: row.workType,
      metric: row.metric,
      op: row.op,
      value: row.value,
      severity: row.severity as "warn" | "stop",
      note: row.note,
    };
    if (isRuleInEffect({ activeFrom: row.activeFrom, activeTo: row.activeTo }, windowStart, windowEnd)) {
      rules.push(rule);
    } else {
      outOfEffect.push({ ...rule, activeFrom: row.activeFrom?.toISOString() ?? null, activeTo: row.activeTo?.toISOString() ?? null });
    }
  }

  const lookback = new Date(windowStart.getTime() - 3 * 3600 * 1000);
  const [weather, marine] = await Promise.all([
    prisma.weatherObservation.findFirst({
      where: { siteId, observedAt: { gte: lookback, lte: windowEnd } },
      orderBy: { observedAt: "desc" },
    }),
    prisma.marineObservation.findFirst({
      where: { siteId, observedAt: { gte: lookback, lte: windowEnd }, source: { not: "open_meteo_marine_info" } },
      orderBy: { observedAt: "desc" },
    }),
  ]);

  const inputs: Record<string, number | null> = {
    temperatureC: weather?.temperatureC ?? null,
    humidityPct: weather?.humidityPct ?? null,
    precipMm1h: weather?.precipMm ?? null,
    windSpeedMs: weather?.windSpeedMs ?? null,
    windGustMs: weather?.windGustMs ?? null,
    sigWaveHM: marine?.sigWaveHM ?? null,
    wavePeriodS: marine?.wavePeriodS ?? null,
  };
  const result = evaluateDecision({ workType, inputs, rules, outOfEffect });

  const decision = await prisma.$transaction(async (tx) => {
    const row = await tx.decisionRecord.create({
      data: {
        siteId,
        workType,
        targetWindowStart: windowStart,
        targetWindowEnd: windowEnd,
        status: result.status,
        reason: result.reason,
        inputs: inputs as never,
        thresholdsSnapshot: {
          rules: result.matchedRules,
          unevaluated: result.unevaluatedRules,
          outOfEffect,
          evaluated: result.evaluatedCount,
        } as never,
      },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({
        action: "施工可否判定",
        target: site.code,
        detail: `${workType}: ${result.status} (window ${windowStart.toISOString()}〜${windowEnd.toISOString()})`,
        level: result.status === "stop" ? "danger" : result.status === "caution" ? "warning" : "info",
      }),
    });
    return row;
  });

  return NextResponse.json({
    data: {
      decision: {
        id: decision.id,
        siteId: decision.siteId,
        workType: decision.workType,
        targetWindowStart: decision.targetWindowStart,
        targetWindowEnd: decision.targetWindowEnd,
        status: decision.status,
        reason: decision.reason,
        inputs: decision.inputs,
        thresholdsSnapshot: decision.thresholdsSnapshot,
        generatedAt: decision.generatedAt,
      },
    },
    meta: { requestId: requestId(), generatedAt: new Date().toISOString() },
    warnings: [decisionNotSupportedWarning],
  });
}
