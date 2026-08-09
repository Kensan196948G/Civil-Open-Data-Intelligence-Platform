/**
 * 国土地理院 DEM のソース種別。数字は解像度(m)、末尾記号は測量方式・精度区分を表す。
 * 優先順位は DEM1A > DEM5A > DEM5B > DEM5C > DEM10B (数値が小さく、精度区分が上位のものを優先)。
 */
export type DemSource = "DEM1A" | "DEM5A" | "DEM5B" | "DEM5C" | "DEM10B";

/**
 * 個々のデータがどの外部ソースから、いつ取得されたかを示す出典情報。
 * Evidence First 原則により、解析結果に紐づくすべてのデータはこの Provenance を持つ。
 */
export interface Provenance {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  readonly termsUrl: string;
  readonly retrievedAt: string;
  readonly sourceVersion?: string;
  readonly resolutionM?: number;
  readonly processed: boolean;
  readonly processingNote?: string;
}
