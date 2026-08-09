import { evaluateCardRule } from "./domain";
import type { CardRule, CheckCard, Coverage, MetricSource } from "./domain";
import { DEFAULT_STEEP_SLOPE_THRESHOLD_DEG } from "./geo";
import type { SectionAnalysisResult } from "./section-service";
import type { TerrainAnalysisResult } from "./terrain-service";

/**
 * 確認支援カード (設計仕様 8.6): 地形分析・断面分析の**実測メトリクス**を
 * ルール評価し、現地確認が必要な項目をカード化する。
 *
 * - 閾値 30° は急傾斜地法 (急傾斜地の崩壊による災害の防止に関する法律) の
 *   「急傾斜地」基準に合わせる。
 * - 欠損メトリクス・coverage NONE は domain の evaluateCardRule が UNKNOWN を
 *   返す (Unknown is not Safe — REFERENCE へ丸めない)。
 * - 複数カードの単純加算による総合危険度は作らない (spec 禁止事項)。
 */

export const CARD_ALGORITHM_VERSION = "web-analysis-v1";

interface CardDefinition {
  readonly rule: CardRule;
  readonly title: string;
  /** 実測値を差し込む観測文。 */
  readonly observation: (metrics: MetricSource) => string;
  readonly unknownObservation: string;
  readonly recommendedChecks: readonly string[];
}

function formatDeg(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)}°`;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

const CARD_DEFINITIONS: readonly CardDefinition[] = [
  {
    rule: {
      ruleId: "steep-slope-max",
      when: { metric: "maxSlopeDeg", gte: DEFAULT_STEEP_SLOPE_THRESHOLD_DEG },
      status: "CHECK_REQUIRED",
      requires: ["terrain"],
      evidence: ["terrain.stats.maxDeg"],
    },
    title: "急傾斜 (30°以上) を検出",
    observation: (m) =>
      `周辺グリッドの最大傾斜は ${formatDeg(m["maxSlopeDeg"])} で、急傾斜地法の基準 (30°) 以上です。`,
    unknownObservation: "傾斜を評価するためのデータが不足しており、急傾斜の有無を判定できません。",
    recommendedChecks: ["現地での傾斜・法面状況の確認", "急傾斜地崩壊危険区域の指定状況の確認"],
  },
  {
    rule: {
      ruleId: "steep-area-ratio",
      when: { metric: "steepRatio", gte: 0.1 },
      status: "CHECK_REQUIRED",
      requires: ["terrain"],
      evidence: ["terrain.stats.steepRatio"],
    },
    title: "急傾斜セルの面積比が高い",
    observation: (m) =>
      `評価セルのうち ${formatPercent(m["steepRatio"])} が傾斜 30° 以上です (基準: 10%)。`,
    unknownObservation: "急傾斜面積比を評価するためのデータが不足しています。",
    recommendedChecks: ["施工範囲と急傾斜部の位置関係の確認"],
  },
  {
    rule: {
      ruleId: "valley-terrain",
      when: { metric: "valleyRatio", gte: 0.15 },
      status: "REFERENCE",
      requires: ["terrain"],
      evidence: ["terrain.classes.valley"],
    },
    title: "谷地形の可能性",
    observation: (m) =>
      `TPI 分類で谷セルが ${formatPercent(m["valleyRatio"])} を占めます。集水・排水計画の参考にしてください。`,
    unknownObservation: "地形分類を評価するためのデータが不足しています。",
    recommendedChecks: ["排水経路・集水地形の現地確認"],
  },
  {
    rule: {
      ruleId: "dem-missing",
      when: { metric: "missingRatio", gt: 0.02 },
      status: "UNKNOWN",
      requires: ["terrain"],
      evidence: ["terrain.quality.missingRatio"],
    },
    title: "DEM 欠損域が含まれる",
    observation: (m) =>
      `対象範囲の ${formatPercent(m["missingRatio"])} で標高データを取得できませんでした。判定不能は安全を意味しません。`,
    unknownObservation: "欠損率そのものを評価できませんでした。判定不能は安全を意味しません。",
    recommendedChecks: ["欠損域の現地確認", "より高解像度の測量データの取得検討"],
  },
  {
    rule: {
      ruleId: "section-steep",
      when: { metric: "sectionMaxSlopeDeg", gte: 25 },
      status: "CHECK_REQUIRED",
      requires: ["section"],
      evidence: ["section.stats.maxSlopeDeg"],
    },
    title: "断面中に急勾配区間",
    observation: (m) =>
      `断面の最大勾配は ${formatDeg(m["sectionMaxSlopeDeg"])} です (基準: 25°)。施工計画前に現地確認を推奨します。`,
    unknownObservation: "断面勾配を評価するためのデータが不足しています。",
    recommendedChecks: ["急勾配区間の現地確認", "断面線の再設定による再評価"],
  },
];

export interface ConfirmCardsInput {
  readonly terrain: TerrainAnalysisResult | null;
  readonly section: SectionAnalysisResult | null;
}

export interface ConfirmCardsOutput {
  readonly cards: readonly CheckCard[];
  /** 評価済みだが閾値未達 (REFERENCE 非表示) のルール数。 */
  readonly passedCount: number;
  /** terrain 解析がまだ無い等で評価対象外だったルール数。 */
  readonly skippedCount: number;
}

/** 実測結果からメトリクス表と被覆状況を作る。 */
function buildMetrics(input: ConfirmCardsInput): { metrics: MetricSource; coverage: Coverage } {
  const metrics: Record<string, number | undefined> = {};
  let coverage: Coverage = "NONE";

  const terrain = input.terrain;
  if (terrain !== null && terrain.kind === "ok") {
    coverage = terrain.quality.coverage;
    metrics["missingRatio"] = terrain.quality.missingRatio;
    if (terrain.stats !== null) {
      metrics["maxSlopeDeg"] = terrain.stats.maxDeg;
      metrics["steepRatio"] = terrain.stats.steepRatio;
    }
    if (terrain.classes.classified > 0) {
      metrics["valleyRatio"] = terrain.classes.counts.valley / terrain.classes.classified;
    }
  }

  const section = input.section;
  if (section !== null && section.kind === "ok") {
    if (coverage === "NONE") {
      coverage = section.quality.coverage;
    }
    if (section.stats.maxSlopeDeg !== null) {
      metrics["sectionMaxSlopeDeg"] = section.stats.maxSlopeDeg;
    }
  }

  return { metrics, coverage };
}

/**
 * カード評価。terrain が未解析 (null) のルールは評価せず skipped に数える。
 * section 依存ルールは断面が引かれている場合のみ評価する。
 */
export function buildConfirmCards(input: ConfirmCardsInput): ConfirmCardsOutput {
  const { metrics, coverage } = buildMetrics(input);
  const hasTerrain = input.terrain !== null;
  const hasSection = input.section !== null;

  const cards: CheckCard[] = [];
  let passedCount = 0;
  let skippedCount = 0;

  for (const definition of CARD_DEFINITIONS) {
    const needsSection = definition.rule.requires.includes("section");
    if ((needsSection && !hasSection) || (!needsSection && !hasTerrain)) {
      skippedCount++;
      continue;
    }
    const result = evaluateCardRule(definition.rule, metrics, coverage);
    if (!result.matched) {
      passedCount++;
      continue;
    }
    cards.push({
      code: definition.rule.ruleId,
      status: result.status,
      title: definition.title,
      observation:
        result.status === "UNKNOWN" && metrics[definition.rule.when.metric] === undefined
          ? definition.unknownObservation
          : definition.observation(metrics),
      recommendedChecks: definition.recommendedChecks,
      evidenceIds: definition.rule.evidence,
      algorithmVersion: CARD_ALGORITHM_VERSION,
    });
  }

  return { cards, passedCount, skippedCount };
}
