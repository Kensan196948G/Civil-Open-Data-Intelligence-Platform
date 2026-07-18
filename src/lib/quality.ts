import { STALE_CHECK_DAYS } from "@/lib/constants";

export type QualityScores = {
  officialSourceScore: number; // 0-20
  freshnessScore: number; // 0-15
  accessibilityScore: number; // 0-15
  licenseClarityScore: number; // 0-15
  formatUsabilityScore: number; // 0-15
  constructionRelevanceScore: number; // 0-20
};

export const SCORE_LIMITS: Record<keyof QualityScores, number> = {
  officialSourceScore: 20,
  freshnessScore: 15,
  accessibilityScore: 15,
  licenseClarityScore: 15,
  formatUsabilityScore: 15,
  constructionRelevanceScore: 20,
};

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

/** 各サブスコアを配点範囲に丸めて合計 (0-100) を返す */
export function computeTotalScore(scores: QualityScores): number {
  return (Object.keys(SCORE_LIMITS) as (keyof QualityScores)[]).reduce(
    (sum, key) => sum + clamp(scores[key], SCORE_LIMITS[key]),
    0,
  );
}

export type QualityInput = {
  organizationType: string;
  lastCheckedAt: Date | null;
  successCount: number;
  failureCount: number;
  licenseName: string | null;
  commercialUse: string;
  dataFormat: string;
  category: string;
  /** 要確認となる未確認期間 (日)。動作設定 staleDays。未指定時は既定値 */
  staleDays?: number;
};

/** データソースの現況から品質サブスコアを決定的に算出する */
export function deriveQualityScores(input: QualityInput, now: Date = new Date()): QualityScores {
  return {
    officialSourceScore: officialScore(input.organizationType),
    freshnessScore: freshnessScore(input.lastCheckedAt, now, input.staleDays ?? STALE_CHECK_DAYS),
    accessibilityScore: accessibilityScore(input.successCount, input.failureCount),
    licenseClarityScore: licenseScore(input.licenseName, input.commercialUse),
    formatUsabilityScore: formatScore(input.dataFormat),
    constructionRelevanceScore: relevanceScore(input.category),
  };
}

function officialScore(organizationType: string): number {
  switch (organizationType) {
    case "national":
      return 20;
    case "local":
      return 16;
    case "private":
      return 10;
    case "community":
      return 8;
    default:
      return 5;
  }
}

function freshnessScore(lastCheckedAt: Date | null, now: Date, staleDays: number): number {
  if (!lastCheckedAt) return 3;
  const days = (now.getTime() - lastCheckedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 7) return 15;
  if (days <= 30) return 12;
  if (days <= staleDays) return 8;
  return 3;
}

function accessibilityScore(successCount: number, failureCount: number): number {
  const total = successCount + failureCount;
  if (total === 0) return 5;
  const rate = successCount / total;
  if (rate >= 0.95) return 15;
  if (rate >= 0.8) return 12;
  if (rate >= 0.5) return 8;
  return 3;
}

function licenseScore(licenseName: string | null, commercialUse: string): number {
  let score = 0;
  if (licenseName) score += 8;
  if (commercialUse === "allowed") score += 7;
  else if (commercialUse === "restricted") score += 5;
  return score;
}

function formatScore(dataFormat: string): number {
  switch (dataFormat) {
    case "JSON":
    case "GeoJSON":
      return 15;
    case "CSV":
    case "XML":
      return 12;
    case "CityGML":
    case "Shapefile":
    case "PNG":
      return 9;
    case "HTML":
      return 5;
    case "PDF":
      return 4;
    default:
      return 5;
  }
}

function relevanceScore(category: string): number {
  switch (category) {
    case "road":
    case "gis":
    case "map-elevation":
      return 20;
    case "weather":
    case "3d-city":
    case "construction":
      return 17;
    case "map":
    case "municipality":
      return 14;
    case "statistics":
      return 12;
    case "research":
      return 10;
    default:
      return 8;
  }
}
