import { describe, expect, it } from "vitest";
import { classifyTerrain, computeSlopeGrid, slopeStatistics } from "@/lib/terrain/geo";
import type { ElevationGrid } from "@/lib/terrain/geo";

/** 行優先で値を並べた width x height グリッドを作る。 */
function grid(
  width: number,
  height: number,
  values: ReadonlyArray<number | null>,
  cellSize = 5,
): ElevationGrid {
  return { width, height, values, cellSizeXM: cellSize, cellSizeYM: cellSize };
}

/** 東方向へ一定勾配で上る平面 (x 1セルごとに +rise m)。 */
function eastSlopePlane(width: number, height: number, rise: number): ElevationGrid {
  const values: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      values.push(x * rise);
    }
  }
  return grid(width, height, values);
}

describe("computeSlopeGrid", () => {
  it("computes a uniform slope for an inclined plane", () => {
    // 5m セルで 1 セルあたり +5m → 45°。
    const g = eastSlopePlane(5, 5, 5);
    const slopes = computeSlopeGrid(g);

    // 境界セルは null、内部セルはすべて 45°。
    expect(slopes[0]).toBeNull();
    const center = slopes[2 * 5 + 2];
    expect(center).toBeCloseTo(45, 5);
  });

  it("returns null where any neighbour is missing (no interpolation)", () => {
    const g = eastSlopePlane(5, 5, 1);
    const values = [...g.values];
    values[1 * 5 + 2] = null; // (2,1) を欠損させる → (2,2) の近傍が欠ける
    const slopes = computeSlopeGrid(grid(5, 5, values));

    expect(slopes[2 * 5 + 2]).toBeNull();
    // 欠損から離れたセルは影響を受けない。
    expect(slopes[3 * 5 + 2]).not.toBeNull();
  });

  it("rejects grids smaller than 3x3", () => {
    expect(() => computeSlopeGrid(grid(2, 2, [0, 0, 0, 0]))).toThrow(RangeError);
  });
});

describe("slopeStatistics", () => {
  it("aggregates mean / max / steep ratio over valid cells", () => {
    const g = eastSlopePlane(5, 5, 5); // 全内部セル 45°
    const stats = slopeStatistics(computeSlopeGrid(g), 5, 5);

    expect(stats).not.toBeNull();
    expect(stats?.meanDeg).toBeCloseTo(45, 5);
    expect(stats?.maxDeg).toBeCloseTo(45, 5);
    expect(stats?.steepRatio).toBe(1); // 45° >= 30°
    expect(stats?.validCount).toBe(9);
    expect(stats?.evaluatedCount).toBe(9);
  });

  it("returns null when no cell could be evaluated (統計を捏造しない)", () => {
    const values = new Array<number | null>(25).fill(null);
    const stats = slopeStatistics(computeSlopeGrid(grid(5, 5, values)), 5, 5);
    expect(stats).toBeNull();
  });
});

describe("classifyTerrain", () => {
  it("classifies a flat plane as flat", () => {
    const g = grid(5, 5, new Array<number | null>(25).fill(100));
    const result = classifyTerrain(g, computeSlopeGrid(g));

    expect(result.counts.flat).toBe(9);
    expect(result.counts.ridge).toBe(0);
    expect(result.unknown).toBe(0);
  });

  it("classifies a peak cell as ridge and a pit cell as valley", () => {
    const peak = new Array<number | null>(25).fill(100);
    peak[2 * 5 + 2] = 110; // 中央だけ突出
    const gPeak = grid(5, 5, peak);
    expect(classifyTerrain(gPeak, computeSlopeGrid(gPeak)).counts.ridge).toBeGreaterThan(0);

    const pit = new Array<number | null>(25).fill(100);
    pit[2 * 5 + 2] = 90;
    const gPit = grid(5, 5, pit);
    expect(classifyTerrain(gPit, computeSlopeGrid(gPit)).counts.valley).toBeGreaterThan(0);
  });

  it("counts cells adjacent to missing data as unknown", () => {
    const values = new Array<number | null>(25).fill(100);
    values[2 * 5 + 2] = null;
    const g = grid(5, 5, values);
    const result = classifyTerrain(g, computeSlopeGrid(g));

    // 中央欠損の近傍 (内部セル8つ) + 中央自身が unknown。
    expect(result.unknown).toBe(9);
    expect(result.classified).toBe(0);
  });
});
