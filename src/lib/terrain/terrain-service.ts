import type { Coordinate, Provenance, QualitySummary } from "./domain";
import {
  METERS_PER_DEGREE_LAT,
  classifyTerrain,
  computeSlopeGrid,
  metersPerDegreeLon,
  slopeStatistics,
} from "./geo";
import type { SlopeStatistics, TerrainClassification } from "./geo";
import {
  DemTileStore,
  provenanceFor,
  sampleElevation,
  summarizeSamples,
  worstGradeOf,
} from "./elevation-sampler";

/**
 * 地形分析 (設計仕様 8.3): 選択地点の周辺グリッドを DEM からサンプルし、
 * Horn 傾斜統計と TPI 地形分類を実データで計算する。
 *
 * グリッドは 33x33 セル・5m 間隔 (DEM5A の解像度) = 約 160m 四方。
 * 表示中の傾斜量図タイルは使わない — 数値評価は DEM から再計算する (要件 6.1)。
 */

export const TERRAIN_GRID_SIZE = 33;
export const TERRAIN_CELL_M = 5;

export type TerrainAnalysisResult =
  | {
      readonly kind: "ok";
      readonly center: Coordinate;
      /** 全内部セルが評価不能なら null (統計は捏造しない)。 */
      readonly stats: SlopeStatistics | null;
      readonly classes: TerrainClassification;
      readonly quality: QualitySummary;
      readonly provenance: readonly Provenance[];
      /** グリッドの一辺の実距離 (m)。 */
      readonly extentM: number;
    }
  | { readonly kind: "no-coverage" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

export interface TerrainServiceDeps {
  readonly store?: DemTileStore;
  readonly now?: () => Date;
}

export async function analyzeTerrain(
  center: Coordinate,
  deps: TerrainServiceDeps = {},
): Promise<TerrainAnalysisResult> {
  const store = deps.store ?? new DemTileStore();
  const now = deps.now ?? ((): Date => new Date());
  const size = TERRAIN_GRID_SIZE;
  const half = (size - 1) / 2;
  const latStep = TERRAIN_CELL_M / METERS_PER_DEGREE_LAT;
  const lonStep = TERRAIN_CELL_M / metersPerDegreeLon(center.lat);

  try {
    const coordinates: Coordinate[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        coordinates.push({
          // 行 0 を北端にする (y 下向き=南向き。傾斜計算は向きに依存しない)。
          lat: center.lat + (half - row) * latStep,
          lon: center.lon + (col - half) * lonStep,
        });
      }
    }

    const outcomes = await Promise.all(
      coordinates.map((coordinate) => sampleElevation(store, coordinate)),
    );
    const summary = summarizeSamples(outcomes);

    if (summary.valid === 0) {
      // 値が 1 つも無い: 失敗混じりなら不在を断定できない (unavailable)。
      return summary.failed > 0 ? { kind: "unavailable" } : { kind: "no-coverage" };
    }

    const grid = {
      width: size,
      height: size,
      values: outcomes.map((outcome) => outcome.elevationM),
      cellSizeXM: TERRAIN_CELL_M,
      cellSizeYM: TERRAIN_CELL_M,
    };
    const slopes = computeSlopeGrid(grid);
    const stats = slopeStatistics(slopes, size, size);
    const classes = classifyTerrain(grid, slopes);

    const missingRatio = (summary.total - summary.valid) / summary.total;
    const warnings: string[] = [];
    if (summary.failed > 0) {
      warnings.push(
        `${summary.failed} 地点でタイル取得に失敗しました。欠損としては扱えず判定不能です。`,
      );
    }
    if (summary.absent > 0) {
      warnings.push(`${summary.absent} 地点は DEM データがありません (データなし ≠ 安全)。`);
    }

    const quality: QualitySummary = {
      grade: worstGradeOf(summary.usedSources),
      missingRatio,
      sourceMix: summary.sourceMix,
      coverage: missingRatio === 0 ? "FULL" : "PARTIAL",
      warnings,
    };

    return {
      kind: "ok",
      center,
      stats,
      classes,
      quality,
      provenance: provenanceFor(summary.usedSources, now().toISOString()),
      extentM: (size - 1) * TERRAIN_CELL_M,
    };
  } catch (error) {
    return { kind: "error", message: String(error) };
  }
}
