// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DemTileStore } from "@/lib/terrain/elevation-sampler";
import { analyzeTerrain } from "@/lib/terrain/terrain-service";
import { fakeTileFetch, pngResponse, uniformDemTile } from "@/lib/terrain/test-tiles";

const CENTER = { lat: 35.36, lon: 138.72 };
const NOW = (): Date => new Date("2026-07-24T05:00:00Z");

describe("analyzeTerrain", () => {
  it("computes flat statistics over a uniform DEM (実データ計算)", async () => {
    const tile = await uniformDemTile(150);
    const store = new DemTileStore(
      fakeTileFetch((url) => (url.includes("dem5a_png") ? pngResponse(tile) : null)),
    );

    const result = await analyzeTerrain(CENTER, { store, now: NOW });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.stats?.meanDeg).toBeCloseTo(0, 5);
    expect(result.stats?.steepRatio).toBe(0);
    expect(result.classes.counts.flat).toBeGreaterThan(0);
    expect(result.classes.counts.ridge).toBe(0);
    expect(result.quality.coverage).toBe("FULL");
    expect(result.quality.grade).toBe("A");
    expect(result.quality.missingRatio).toBe(0);
    expect(result.provenance[0]?.sourceName).toContain("DEM5A");
    expect(result.extentM).toBe(160);
  });

  it("returns no-coverage when every source legitimately lacks tiles", async () => {
    const store = new DemTileStore(fakeTileFetch(() => null)); // 全て 404

    const result = await analyzeTerrain(CENTER, { store, now: NOW });

    expect(result.kind).toBe("no-coverage");
  });

  it("returns unavailable when fetches fail (絶対に no-coverage に丸めない)", async () => {
    const store = new DemTileStore(
      fakeTileFetch(() => {
        throw new Error("upstream down");
      }),
    );

    const result = await analyzeTerrain(CENTER, { store, now: NOW });

    expect(result.kind).toBe("unavailable");
  });
});
