// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { QualitySummary } from "@/lib/terrain/domain";
import { buildConfirmCards } from "@/lib/terrain/confirm-cards";
import type { TerrainAnalysisResult } from "@/lib/terrain/terrain-service";
import type { SectionAnalysisResult } from "@/lib/terrain/section-service";

function quality(missingRatio: number): QualitySummary {
  return {
    grade: "A",
    missingRatio,
    sourceMix: { DEM1A: 0, DEM5A: 1, DEM5B: 0, DEM5C: 0, DEM10B: 0 },
    coverage: missingRatio === 0 ? "FULL" : "PARTIAL",
    warnings: [],
  };
}

function terrainOk(opts: {
  maxDeg: number;
  steepRatio?: number;
  valleyRatio?: number;
  missingRatio?: number;
}): TerrainAnalysisResult {
  const valley = Math.round((opts.valleyRatio ?? 0) * 100);
  return {
    kind: "ok",
    center: { lat: 35, lon: 138 },
    stats: {
      meanDeg: 10,
      maxDeg: opts.maxDeg,
      steepRatio: opts.steepRatio ?? 0,
      steepThresholdDeg: 30,
      validCount: 100,
      evaluatedCount: 100,
    },
    classes: {
      counts: { ridge: 0, slope: 100 - valley, valley, flat: 0 },
      classified: 100,
      unknown: 0,
      tpiThresholdM: 1,
      flatSlopeDeg: 5,
    },
    quality: quality(opts.missingRatio ?? 0),
    provenance: [],
    extentM: 160,
  };
}

describe("buildConfirmCards", () => {
  it("raises CHECK_REQUIRED with the measured value when max slope exceeds 30°", () => {
    const output = buildConfirmCards({ terrain: terrainOk({ maxDeg: 34.2 }), section: null });

    const steep = output.cards.find((card) => card.code === "steep-slope-max");
    expect(steep?.status).toBe("CHECK_REQUIRED");
    expect(steep?.observation).toContain("34.2°");
  });

  it("keeps below-threshold rules out of the cards but counts them as passed", () => {
    const output = buildConfirmCards({ terrain: terrainOk({ maxDeg: 12 }), section: null });

    expect(output.cards.find((card) => card.code === "steep-slope-max")).toBeUndefined();
    expect(output.passedCount).toBeGreaterThan(0);
  });

  it("emits an UNKNOWN card for DEM missing areas (データなし ≠ 安全)", () => {
    const output = buildConfirmCards({
      terrain: terrainOk({ maxDeg: 12, missingRatio: 0.1 }),
      section: null,
    });

    const missing = output.cards.find((card) => card.code === "dem-missing");
    expect(missing?.status).toBe("UNKNOWN");
    expect(missing?.observation).toContain("10.0%");
  });

  it("evaluates section rules only when a section exists", () => {
    const section: SectionAnalysisResult = {
      kind: "ok",
      start: { lat: 35, lon: 138 },
      end: { lat: 35, lon: 138.02 },
      samples: [
        { distanceM: 0, elevationM: 100 },
        { distanceM: 100, elevationM: 160 },
      ],
      stats: {
        totalLengthM: 100,
        gainM: 60,
        lossM: 0,
        meanSlopeDeg: 31,
        maxSlopeDeg: 31,
        validSampleRatio: 1,
        validSegmentLengthM: 100,
        sampleCount: 2,
      },
      quality: quality(0),
      provenance: [],
    };

    const without = buildConfirmCards({ terrain: terrainOk({ maxDeg: 5 }), section: null });
    expect(without.cards.find((card) => card.code === "section-steep")).toBeUndefined();
    expect(without.skippedCount).toBe(1);

    const withSection = buildConfirmCards({ terrain: terrainOk({ maxDeg: 5 }), section });
    const card = withSection.cards.find((c) => c.code === "section-steep");
    expect(card?.status).toBe("CHECK_REQUIRED");
    expect(card?.observation).toContain("31.0°");
  });

  it("skips everything when no analysis has run yet", () => {
    const output = buildConfirmCards({ terrain: null, section: null });
    expect(output.cards).toHaveLength(0);
    expect(output.skippedCount).toBe(5);
  });
});
