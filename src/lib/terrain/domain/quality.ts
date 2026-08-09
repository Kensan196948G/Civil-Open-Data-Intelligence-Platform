import type { DemSource } from "./provenance";

/**
 * 解析結果の品質評価。データ欠損・複数ソース混在の度合いを示す。
 * UNKNOWN は「品質が悪い」ではなく「品質を評価できるだけの情報がない」ことを表す。
 */
export type QualityGrade = "A" | "B" | "C" | "D" | "UNKNOWN";

/**
 * データ被覆状況。NONE は対象範囲に有効なデータソースが一切存在しないことを示す
 * (低品質と混同しないこと。Unknown is not Safe 原則)。
 */
export type Coverage = "FULL" | "PARTIAL" | "NONE";

export interface QualitySummary {
  readonly grade: QualityGrade;
  /** 0..1 の範囲。対象範囲内で有効値が得られなかった比率。 */
  readonly missingRatio: number;
  /** 分析に使用した DEM ソースごとのピクセル(またはサンプル)数。未使用のソースは 0。 */
  readonly sourceMix: Readonly<Record<DemSource, number>>;
  readonly coverage: Coverage;
  readonly warnings: readonly string[];
}
