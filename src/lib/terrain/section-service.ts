import type { Coordinate, Provenance, QualitySummary } from "./domain";
import { haversineDistanceM, profileStatistics } from "./geo";
import type { ProfileSample, ProfileStatistics } from "./geo";
import {
  DemTileStore,
  provenanceFor,
  sampleElevation,
  summarizeSamples,
  worstGradeOf,
} from "./elevation-sampler";

/**
 * 断面分析 (設計仕様 8.4): 始点→終点の直線に沿って DEM をサンプルし、
 * 縦断プロファイルと距離・勾配統計を実データで計算する。
 * 欠損サンプルは補間せずギャップとして保持する (プロファイル描画側も同様)。
 */

/** サンプル間隔の目安 (m)。DEM5A 解像度 5m に対し 10m で十分。 */
const SAMPLE_SPACING_M = 10;
const MIN_SAMPLES = 40;
const MAX_SAMPLES = 240;

/** 断面線の最小長 (m)。これ未満は勾配が数値誤差に埋もれる。 */
export const MIN_SECTION_LENGTH_M = 30;
/** 断面線の最大長 (m)。タイル取得数と描画粒度の実用上限。 */
export const MAX_SECTION_LENGTH_M = 20000;

export type SectionAnalysisResult =
  | {
      readonly kind: "ok";
      readonly start: Coordinate;
      readonly end: Coordinate;
      readonly samples: readonly ProfileSample[];
      readonly stats: ProfileStatistics;
      readonly quality: QualitySummary;
      readonly provenance: readonly Provenance[];
    }
  | { readonly kind: "too-short"; readonly lengthM: number }
  | { readonly kind: "too-long"; readonly lengthM: number }
  | { readonly kind: "no-coverage" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

export interface SectionServiceDeps {
  readonly store?: DemTileStore;
  readonly now?: () => Date;
}

export async function analyzeSection(
  start: Coordinate,
  end: Coordinate,
  deps: SectionServiceDeps = {},
): Promise<SectionAnalysisResult> {
  const store = deps.store ?? new DemTileStore();
  const now = deps.now ?? ((): Date => new Date());

  try {
    const lengthM = haversineDistanceM(start, end);
    if (lengthM < MIN_SECTION_LENGTH_M) {
      return { kind: "too-short", lengthM };
    }
    if (lengthM > MAX_SECTION_LENGTH_M) {
      return { kind: "too-long", lengthM };
    }

    const sampleCount = Math.min(
      MAX_SAMPLES,
      Math.max(MIN_SAMPLES, Math.ceil(lengthM / SAMPLE_SPACING_M) + 1),
    );

    // 数 km スケールでは直線 (等差) 補間で十分 (誤差は DEM 解像度未満)。
    const coordinates: Coordinate[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const t = i / (sampleCount - 1);
      coordinates.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t,
      });
    }

    const outcomes = await Promise.all(
      coordinates.map((coordinate) => sampleElevation(store, coordinate)),
    );
    const summary = summarizeSamples(outcomes);

    if (summary.valid === 0) {
      return summary.failed > 0 ? { kind: "unavailable" } : { kind: "no-coverage" };
    }

    const samples: ProfileSample[] = outcomes.map((outcome, i) => ({
      distanceM: (lengthM * i) / (sampleCount - 1),
      elevationM: outcome.elevationM,
    }));
    const stats = profileStatistics(samples);

    const missingRatio = (summary.total - summary.valid) / summary.total;
    const warnings: string[] = [];
    if (summary.failed > 0) {
      warnings.push(
        `${summary.failed} 地点でタイル取得に失敗しました。欠損としては扱えず判定不能です。`,
      );
    }
    if (summary.absent > 0) {
      warnings.push(
        `${summary.absent} 地点は DEM データがありません。欠損区間は勾配評価から除外しています (データなし ≠ 安全)。`,
      );
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
      start,
      end,
      samples,
      stats,
      quality,
      provenance: provenanceFor(summary.usedSources, now().toISOString()),
    };
  } catch (error) {
    return { kind: "error", message: String(error) };
  }
}
