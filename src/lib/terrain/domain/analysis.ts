/**
 * 要確認カード1件の判定結果。
 * REFERENCE: 参考情報として提示(閾値未達、または明確に低リスク)。
 * CHECK_REQUIRED: 現地調査・追加確認を推奨。
 * UNKNOWN: 判定に必要なデータが欠損・取得失敗しており判定不能
 *          (Unknown is not Safe 原則により REFERENCE へは絶対に丸めない)。
 */
export type RiskStatus = "REFERENCE" | "CHECK_REQUIRED" | "UNKNOWN";

/**
 * 分析リクエストのライフサイクル状態。
 * 終端状態は Rejected / Complete / Partial / Unknown の4種。
 */
export type AnalysisStatus =
  | "REQUESTED"
  | "VALIDATING"
  | "REJECTED"
  | "FETCHING"
  | "ANALYZING"
  | "COMPLETE"
  | "PARTIAL"
  | "UNKNOWN";

export const TERMINAL_ANALYSIS_STATUSES: readonly AnalysisStatus[] = [
  "REJECTED",
  "COMPLETE",
  "PARTIAL",
  "UNKNOWN",
];

export function isTerminalAnalysisStatus(status: AnalysisStatus): boolean {
  return TERMINAL_ANALYSIS_STATUSES.includes(status);
}

/**
 * 個別の要確認カード。複数カードの単純加算による「総合危険度」は意図的に提供しない
 * (地形由来の観測と公的ハザード区域を同一尺度に混同しないため)。
 */
export interface CheckCard {
  readonly code: string;
  readonly status: RiskStatus;
  readonly title: string;
  readonly observation: string;
  readonly recommendedChecks: readonly string[];
  readonly distanceM?: number;
  readonly evidenceIds: readonly string[];
  readonly algorithmVersion: string;
}
