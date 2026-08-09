// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DemTileStore } from "@/lib/terrain/elevation-sampler";
import { analyzeSection } from "@/lib/terrain/section-service";
import { fakeTileFetch, pngResponse, uniformDemTile } from "@/lib/terrain/test-tiles";

const START = { lat: 35.36, lon: 138.72 };
const END = { lat: 35.36, lon: 138.74 }; // 約 1.8 km 東
const NOW = (): Date => new Date("2026-07-24T05:00:00Z");

describe("analyzeSection", () => {
  it("builds a profile with real sampled elevations", async () => {
    const tile = await uniformDemTile(300);
    const store = new DemTileStore(
      fakeTileFetch((url) => (url.includes("dem5a_png") ? pngResponse(tile) : null)),
    );

    const result = await analyzeSection(START, END, { store, now: NOW });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stats.totalLengthM).toBeGreaterThan(1500);
    expect(result.stats.gainM).toBe(0); // 平坦
    expect(result.stats.meanSlopeDeg).toBeCloseTo(0, 5);
    expect(result.samples.length).toBeGreaterThanOrEqual(40);
    expect(result.samples.every((s) => s.elevationM !== null)).toBe(true);
    expect(result.quality.coverage).toBe("FULL");
  });

  it("rejects a line that is too short to evaluate", async () => {
    const store = new DemTileStore(fakeTileFetch(() => null));
    const result = await analyzeSection(START, { lat: 35.36, lon: 138.72001 }, { store });
    expect(result.kind).toBe("too-short");
  });

  it("returns unavailable when fetches fail", async () => {
    const store = new DemTileStore(
      fakeTileFetch(() => {
        throw new Error("down");
      }),
    );
    const result = await analyzeSection(START, END, { store });
    expect(result.kind).toBe("unavailable");
  });
});
