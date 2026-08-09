import { NextRequest, NextResponse } from "next/server";
import { analyzeTerrain } from "@/lib/terrain/terrain-service";
import { DemTileStore } from "@/lib/terrain/elevation-sampler";
import { gsiFetch } from "@/lib/terrain/gsi-fetch";
import { buildConfirmCards } from "@/lib/terrain/confirm-cards";
import { isValidCoordinate } from "@/lib/terrain/domain";
import type { TerrainAnalysisResult } from "@/lib/terrain/terrain-service";
import type { CheckCard } from "@/lib/terrain/domain";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId, v1RateLimitResponse } from "@/lib/v1-response";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

type TerrainOk = Extract<TerrainAnalysisResult, { kind: "ok" }>;

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function escapeCsv(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toMarkdown(result: TerrainOk, cards: readonly CheckCard[], passedCount: number, skippedCount: number): string {
  const lines: string[] = [
    "# 地形分析レポート",
    "",
    `- 対象地点: 緯度 ${result.center.lat.toFixed(6)} / 経度 ${result.center.lon.toFixed(6)}`,
    `- 評価範囲: 約 ${result.extentM}m 四方`,
    `- 生成日時: ${new Date().toISOString()}`,
    "",
    "## 傾斜統計",
    result.stats === null
      ? "有効な標高セルが不足しており傾斜統計を計算できませんでした (判定不能)。"
      : [
          "| 指標 | 値 |",
          "| --- | --- |",
          `| 平均傾斜 | ${result.stats.meanDeg.toFixed(1)}° |`,
          `| 最大傾斜 | ${result.stats.maxDeg.toFixed(1)}° |`,
          `| 急傾斜 (${result.stats.steepThresholdDeg}°以上) 面積比 | ${(result.stats.steepRatio * 100).toFixed(1)}% |`,
          `| 評価セル | ${result.stats.validCount}/${result.stats.evaluatedCount} |`,
        ].join("\n"),
    "",
    "## 地形分類 (TPI)",
    `尾根 ${result.classes.counts.ridge} / 斜面 ${result.classes.counts.slope} / 谷 ${result.classes.counts.valley} / 平坦 ${result.classes.counts.flat} / 分類不能 ${result.classes.unknown}`,
    "",
    "## 品質・出典",
    `品質グレード: ${result.quality.grade} / 欠損率: ${(result.quality.missingRatio * 100).toFixed(1)}% / 被覆: ${result.quality.coverage}`,
    ...result.provenance.map((p) => `- ${p.sourceName} (${p.sourceUrl})`),
    "",
    "## 確認支援カード",
    cards.length === 0 ? `しきい値超過なし (passed ${passedCount}, skipped ${skippedCount})` : "",
    ...cards.map((card) =>
      `- [${card.status}] ${card.title}: ${card.observation}${card.recommendedChecks.length ? ` (推奨: ${card.recommendedChecks.join(" / ")})` : ""}`,
    ),
    "",
    "> ⚠️ 本レポートは確認支援です。施工可否・安全性・法令適合を断定しません。最終判断は担当者が行ってください。",
  ];
  return lines.filter((line) => line !== "").join("\n") + "\n";
}

function toCsv(result: TerrainOk): string {
  const rows: string[][] = [
    ["metric", "value"],
    ["lat", String(result.center.lat)],
    ["lon", String(result.center.lon)],
    ["extentM", String(result.extentM)],
    ["qualityGrade", result.quality.grade],
    ["missingRatio", (result.quality.missingRatio * 100).toFixed(1)],
    ["coverage", result.quality.coverage],
  ];
  if (result.stats !== null) {
    rows.push(["meanSlopeDeg", result.stats.meanDeg.toFixed(2)]);
    rows.push(["maxSlopeDeg", result.stats.maxDeg.toFixed(2)]);
    rows.push(["steepRatio", result.stats.steepRatio.toFixed(4)]);
    rows.push(["validCount", String(result.stats.validCount)]);
  }
  rows.push(["ridgeCount", String(result.classes.counts.ridge)]);
  rows.push(["slopeCount", String(result.classes.counts.slope)]);
  rows.push(["valleyCount", String(result.classes.counts.valley)]);
  rows.push(["flatCount", String(result.classes.counts.flat)]);
  rows.push(["unknownCount", String(result.classes.unknown)]);
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:terrain:export", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const format = (sp.get("format") ?? "markdown").toLowerCase();
  if (!["markdown", "csv", "json"].includes(format)) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "format は markdown / csv / json のいずれかを指定してください" } },
      { status: 400 },
    );
  }

  const lat = parseNumber(sp.get("lat"));
  const lon = parseNumber(sp.get("lon"));
  if (lat === null || lon === null || !isValidCoordinate({ lat, lon })) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "lat は -90〜90、lon は -180〜180 の数値で指定してください" } },
      { status: 400 },
    );
  }

  const id = requestId();
  const result = await analyzeTerrain(
    { lat, lon },
    { store: new DemTileStore(gsiFetch), now: () => new Date() },
  );
  if (result.kind !== "ok") {
    return NextResponse.json(
      {
        error: {
          code: result.kind === "no-coverage" ? "no_coverage" : "upstream_unavailable",
          message:
            result.kind === "no-coverage"
              ? "この範囲の DEM データはありません。データが無いことは安全を意味しません。"
              : "DEM の取得に失敗しました。判定不能は安全を意味しません。",
        },
      },
      { status: result.kind === "no-coverage" ? 404 : 503 },
    );
  }

  const cards = buildConfirmCards({ terrain: result, section: null });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `codip-terrain-${lat.toFixed(5)}-${lon.toFixed(5)}-${timestamp}.${format}`;

  if (format === "json") {
    return NextResponse.json(
      {
        data: {
          point: result.center,
          stats: result.stats,
          classes: result.classes,
          quality: result.quality,
          provenance: result.provenance,
          cards: cards.cards,
          generatedAt: new Date().toISOString(),
        },
        meta: { requestId: id },
        warnings: [decisionNotSupportedWarning],
      },
      {
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      },
    );
  }

  const content = format === "csv" ? toCsv(result) : toMarkdown(result, cards.cards, cards.passedCount, cards.skippedCount);
  return new NextResponse(content, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
