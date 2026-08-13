import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { renderReport, REPORT_FORMATS, type ReportFormat } from "@/lib/report-export";
import { requireRoleOrAdmin } from "@/lib/rbac";

const TEMPLATES = new Set(["daily", "weekly", "monthly", "decision", "marine", "annual"]);

export async function POST(request: NextRequest) {
  // RBAC: engineer 以上（auditor 含む）がレポートを出力できる
  const authError = await requireRoleOrAdmin(request, [
    "engineer",
    "data-steward",
    "admin",
    "auditor",
  ]);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:reports:write", clientIdentifier(request), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const siteId = typeof body?.siteId === "string" ? body.siteId : "";
  const template = typeof body?.template === "string" ? body.template : "";
  const format: ReportFormat = REPORT_FORMATS.includes(body?.format) ? body.format : "csv";
  if (!siteId || !TEMPLATES.has(template)) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId/template(daily|weekly|monthly|decision|marine|annual) を確認してください" } }, { status: 400 });
  }
  const from = body?.dateFrom ? new Date(body.dateFrom) : null;
  const to = body?.dateTo ? new Date(body.dateTo) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) {
    return NextResponse.json({ error: { code: "invalid_query", message: "dateFrom/dateTo (YYYY-MM-DD) を確認してください" } }, { status: 422 });
  }
  const toEnd = new Date(to.getTime() + 24 * 3600 * 1000);

  const [weather, marine, decisions] = await Promise.all([
    template === "decision" ? [] : prisma.weatherObservation.findMany({ where: { siteId, observedAt: { gte: from, lt: toEnd } }, orderBy: { observedAt: "asc" } }),
    ["daily", "weekly", "monthly", "marine", "annual"].includes(template)
      ? prisma.marineObservation.findMany({ where: { siteId, observedAt: { gte: from, lt: toEnd } }, orderBy: { observedAt: "asc" } })
      : [],
    template === "decision" ? prisma.decisionRecord.findMany({ where: { siteId, generatedAt: { gte: from, lt: toEnd } }, orderBy: { generatedAt: "asc" } }) : [],
  ]);

  let headers: string[] = [];
  let rows: unknown[][] = [];
  if (template === "daily") {
    headers = ["observedAt", "temperatureC", "humidityPct", "pressureHpa", "precipMm", "windSpeedMs", "windGustMs", "windDirDeg", "sunshineH", "sigWaveHM", "wavePeriodS", "waveDirDeg", "tideLevelM", "currentSpeedMs"];
    const byTime = new Map<string, [typeof weather[number] | null, typeof marine[number] | null]>();
    for (const w of weather) byTime.set(w.observedAt.toISOString(), [w, null]);
    for (const m of marine) {
      const key = m.observedAt.toISOString();
      const existing = byTime.get(key);
      byTime.set(key, existing ? [existing[0], m] : [null, m]);
    }
    rows = [...byTime.keys()].sort().map((key) => {
      const [w, m] = byTime.get(key) as [typeof weather[number] | null, typeof marine[number] | null];
      return [key, w?.temperatureC, w?.humidityPct, w?.pressureHpa, w?.precipMm, w?.windSpeedMs, w?.windGustMs, w?.windDirDeg, w?.sunshineH, m?.sigWaveHM, m?.wavePeriodS, m?.waveDirDeg, m?.tideLevelM, m?.currentSpeedMs];
    });
  } else if (template === "marine") {
    headers = ["observedAt", "sigWaveHM", "wavePeriodS", "waveDirDeg", "tideLevelM", "currentSpeedMs", "currentDirDeg"];
    rows = marine.map((m) => [m.observedAt, m.sigWaveHM, m.wavePeriodS, m.waveDirDeg, m.tideLevelM, m.currentSpeedMs, m.currentDirDeg]);
  } else if (template === "decision") {
    headers = ["generatedAt", "workType", "status", "reason", "inputs", "thresholdsSnapshot"];
    rows = decisions.map((d) => [d.generatedAt, d.workType, d.status, d.reason, JSON.stringify(d.inputs), JSON.stringify(d.thresholdsSnapshot)]);
  } else {
    headers = ["period", "avgTempC", "maxWindMs", "totalRainMm", "avgWaveHM", "maxWaveHM"];
    rows = summarizePeriods(weather, marine, template);
  }

  const rendered = renderReport(format, headers, rows, template, siteId);
  const filename = `report_${template}_${siteId.slice(0, 8)}.${rendered.extension}`;
  return new NextResponse(rendered.body, {
    headers: {
      "Content-Type": rendered.contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function summarizePeriods(
  weather: { observedAt: Date; temperatureC: number | null; windSpeedMs: number | null; precipMm: number | null }[],
  marine: { observedAt: Date; sigWaveHM: number | null }[],
  template: "weekly" | "monthly" | "annual",
): unknown[][] {
  const key = (date: Date) =>
    template === "weekly"
      ? `${date.getUTCFullYear()}-W${String(Math.ceil(((date.getUTCDate() - 1) + date.getUTCDay()) / 7)).padStart(2, "0")}`
      : template === "monthly"
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
        : String(date.getUTCFullYear());
  const buckets = new Map<string, { temps: number[]; winds: number[]; rains: number[]; waves: number[] }>();
  for (const w of weather) {
    const b = buckets.get(key(w.observedAt)) ?? { temps: [], winds: [], rains: [], waves: [] };
    if (w.temperatureC !== null) b.temps.push(w.temperatureC);
    if (w.windSpeedMs !== null) b.winds.push(w.windSpeedMs);
    if (w.precipMm !== null) b.rains.push(w.precipMm);
    buckets.set(key(w.observedAt), b);
  }
  for (const m of marine) {
    const k = key(m.observedAt);
    const b = buckets.get(k) ?? { temps: [], winds: [], rains: [], waves: [] };
    if (m.sigWaveHM !== null) b.waves.push(m.sigWaveHM);
    buckets.set(k, b);
  }
  return [...buckets.keys()].sort().map((period) => {
    const b = buckets.get(period) as { temps: number[]; winds: number[]; rains: number[]; waves: number[] };
    const mean = (v: number[]) => (v.length ? v.reduce((a, c) => a + c, 0) / v.length : null);
    return [
      period,
      round(mean(b.temps)),
      b.winds.length ? round(Math.max(...b.winds)) : null,
      round(b.rains.length ? b.rains.reduce((a, c) => a + c, 0) : null),
      round(mean(b.waves)),
      b.waves.length ? round(Math.max(...b.waves)) : null,
    ];
  });
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}
