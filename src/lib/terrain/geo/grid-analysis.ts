import { calculateSlopeDeg } from "./slope";
import type { Neighborhood3x3 } from "./slope";

/**
 * 地点周辺グリッドの傾斜・地形分類解析 (設計仕様 8.3)。
 *
 * 入力は行優先の標高グリッド。欠損セルは null で表し、**補間しない**
 * (spec 要件: 欠損を推定値で埋めると「データなし ≠ 安全」の追跡が壊れる)。
 * 欠損に接するセルの傾斜・分類は undefined 扱い (unknown) とし、統計母数から
 * 除外したうえで件数を明示する。
 */

export interface ElevationGrid {
  /** 列数。 */
  readonly width: number;
  /** 行数。 */
  readonly height: number;
  /** 行優先 (index = y * width + x)。null = データなし。 */
  readonly values: ReadonlyArray<number | null>;
  /** 隣接列間の実距離 (m)。緯度補正済みの値を渡すこと。 */
  readonly cellSizeXM: number;
  /** 隣接行間の実距離 (m)。 */
  readonly cellSizeYM: number;
}

function assertGridShape(grid: ElevationGrid): void {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height)) {
    throw new RangeError("grid dimensions must be integers");
  }
  if (grid.width < 3 || grid.height < 3) {
    throw new RangeError("grid must be at least 3x3 to evaluate slopes");
  }
  if (grid.values.length !== grid.width * grid.height) {
    throw new RangeError(
      `values length ${grid.values.length} does not match ${grid.width}x${grid.height}`,
    );
  }
  if (!(grid.cellSizeXM > 0) || !(grid.cellSizeYM > 0)) {
    throw new RangeError("cell sizes must be positive");
  }
}

function cellAt(grid: ElevationGrid, x: number, y: number): number | null {
  return grid.values[y * grid.width + x] ?? null;
}

function neighborhoodAt(grid: ElevationGrid, x: number, y: number): Neighborhood3x3 {
  return {
    z1: cellAt(grid, x - 1, y - 1),
    z2: cellAt(grid, x, y - 1),
    z3: cellAt(grid, x + 1, y - 1),
    z4: cellAt(grid, x - 1, y),
    z5: cellAt(grid, x, y),
    z6: cellAt(grid, x + 1, y),
    z7: cellAt(grid, x - 1, y + 1),
    z8: cellAt(grid, x, y + 1),
    z9: cellAt(grid, x + 1, y + 1),
  };
}

/**
 * 内部セル (境界を除く) ごとの傾斜 (度)。近傍9セルのいずれかが欠損なら null。
 * 返り値はグリッドと同じ行優先レイアウトで、境界セルは常に null。
 */
export function computeSlopeGrid(grid: ElevationGrid): ReadonlyArray<number | null> {
  assertGridShape(grid);
  const slopes = new Array<number | null>(grid.width * grid.height).fill(null);
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      slopes[y * grid.width + x] = calculateSlopeDeg(
        neighborhoodAt(grid, x, y),
        grid.cellSizeXM,
        grid.cellSizeYM,
      );
    }
  }
  return slopes;
}

export interface SlopeStatistics {
  readonly meanDeg: number;
  readonly maxDeg: number;
  /** 急傾斜 (しきい値以上) セルの有効セルに対する比率 0..1。 */
  readonly steepRatio: number;
  readonly steepThresholdDeg: number;
  /** 傾斜を評価できたセル数。 */
  readonly validCount: number;
  /** 評価対象セル数 (内部セル数)。 */
  readonly evaluatedCount: number;
}

/**
 * 急傾斜しきい値の既定は 30° — 急傾斜地の崩壊による災害の防止に関する法律が
 * 定める「急傾斜地」の基準 (傾斜度30度以上) に合わせる。
 */
export const DEFAULT_STEEP_SLOPE_THRESHOLD_DEG = 30;

/**
 * 傾斜グリッドの統計。有効セルが 1 つも無い場合は null (統計は捏造しない)。
 */
export function slopeStatistics(
  slopes: ReadonlyArray<number | null>,
  gridWidth: number,
  gridHeight: number,
  steepThresholdDeg: number = DEFAULT_STEEP_SLOPE_THRESHOLD_DEG,
): SlopeStatistics | null {
  const evaluatedCount = Math.max(0, (gridWidth - 2) * (gridHeight - 2));
  let sum = 0;
  let max = -Infinity;
  let valid = 0;
  let steep = 0;
  for (const slope of slopes) {
    if (slope === null) {
      continue;
    }
    valid++;
    sum += slope;
    if (slope > max) {
      max = slope;
    }
    if (slope >= steepThresholdDeg) {
      steep++;
    }
  }
  if (valid === 0) {
    return null;
  }
  return {
    meanDeg: sum / valid,
    maxDeg: max,
    steepRatio: steep / valid,
    steepThresholdDeg,
    validCount: valid,
    evaluatedCount,
  };
}

/**
 * 地形分類 (簡易 TPI 法)。セルの標高と近傍8セル平均の差 (Topographic Position
 * Index) で尾根/谷を、傾斜で平坦/斜面を分ける:
 *   TPI >= +threshold → ridge / TPI <= -threshold → valley
 *   それ以外で slope < flatSlopeDeg → flat、それ以外 → slope
 * 近傍に欠損があるセルは unknown (補間しない)。
 */
export type TerrainClass = "ridge" | "slope" | "valley" | "flat";

export interface TerrainClassification {
  readonly counts: Readonly<Record<TerrainClass, number>>;
  /** 分類できたセル数。 */
  readonly classified: number;
  /** データ欠損等で分類できなかった内部セル数。 */
  readonly unknown: number;
  readonly tpiThresholdM: number;
  readonly flatSlopeDeg: number;
}

export interface TerrainClassificationOptions {
  readonly tpiThresholdM?: number;
  readonly flatSlopeDeg?: number;
}

export function classifyTerrain(
  grid: ElevationGrid,
  slopes: ReadonlyArray<number | null>,
  options: TerrainClassificationOptions = {},
): TerrainClassification {
  assertGridShape(grid);
  const tpiThresholdM = options.tpiThresholdM ?? 1.0;
  const flatSlopeDeg = options.flatSlopeDeg ?? 5.0;
  const counts: Record<TerrainClass, number> = { ridge: 0, slope: 0, valley: 0, flat: 0 };
  let classified = 0;
  let unknown = 0;

  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      const center = cellAt(grid, x, y);
      const slope = slopes[y * grid.width + x] ?? null;
      const n = neighborhoodAt(grid, x, y);
      const ring = [n.z1, n.z2, n.z3, n.z4, n.z6, n.z7, n.z8, n.z9];
      if (center === null || slope === null || ring.some((z) => z === null)) {
        unknown++;
        continue;
      }
      const ringSum = ring.reduce<number>((acc, z) => acc + (z as number), 0);
      const tpi = center - ringSum / ring.length;
      classified++;
      if (tpi >= tpiThresholdM) {
        counts.ridge++;
      } else if (tpi <= -tpiThresholdM) {
        counts.valley++;
      } else if (slope < flatSlopeDeg) {
        counts.flat++;
      } else {
        counts.slope++;
      }
    }
  }

  return { counts, classified, unknown, tpiThresholdM, flatSlopeDeg };
}
