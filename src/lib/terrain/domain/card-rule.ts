import type { Coverage } from "./quality";
import type { RiskStatus } from "./analysis";

export type ComparisonOperator = "gte" | "gt" | "lte" | "lt" | "eq";

/**
 * 単一メトリクスに対する閾値条件。複数演算子を同時指定した場合は AND として扱う。
 * 詳細設計仕様書 8.6 の `when: { metric, gte }` に対応。
 */
export interface MetricCondition {
  readonly metric: string;
  readonly gte?: number;
  readonly gt?: number;
  readonly lte?: number;
  readonly lt?: number;
  readonly eq?: number;
}

/**
 * 要確認カード生成ルール。DB の `config_versions.rule_json` で版管理される想定であり、
 * コードへの直書きを避けるためデータとして扱えるようプレーンな型にしている。
 */
export interface CardRule {
  readonly ruleId: string;
  readonly when: MetricCondition;
  readonly status: RiskStatus;
  readonly requires: readonly string[];
  readonly evidence: readonly string[];
}

export type MetricSource = Readonly<Record<string, number | undefined>>;

export interface CardRuleEvaluationResult {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly status: RiskStatus;
}

function compareMetric(condition: MetricCondition, value: number): boolean {
  if (condition.gte !== undefined && !(value >= condition.gte)) return false;
  if (condition.gt !== undefined && !(value > condition.gt)) return false;
  if (condition.lte !== undefined && !(value <= condition.lte)) return false;
  if (condition.lt !== undefined && !(value < condition.lt)) return false;
  if (condition.eq !== undefined && !(value === condition.eq)) return false;
  return true;
}

/**
 * ルールを評価する。
 *
 * 判定不能 (UNKNOWN) を優先的に返す2つのケースを明示的に扱う:
 * 1. 対象範囲のデータ被覆が NONE (有効なデータソースが存在しない)
 * 2. ルールが参照するメトリクスが欠損しているか、有限数でない (NaN / ±Infinity)
 *
 * どの場合も「条件不成立 = REFERENCE (低リスク)」へ丸めない
 * (Unknown is not Safe 原則。欠損を数値0として比較すると誤って REFERENCE 側に倒れ、
 * NaN は全比較演算が false になるため同様に REFERENCE 側へ倒れてしまう)。
 */
export function evaluateCardRule(
  rule: CardRule,
  metrics: MetricSource,
  coverage: Coverage,
): CardRuleEvaluationResult {
  if (coverage === "NONE") {
    return { ruleId: rule.ruleId, matched: true, status: "UNKNOWN" };
  }

  const value = metrics[rule.when.metric];
  if (value === undefined || !Number.isFinite(value)) {
    return { ruleId: rule.ruleId, matched: true, status: "UNKNOWN" };
  }

  const matched = compareMetric(rule.when, value);
  return {
    ruleId: rule.ruleId,
    matched,
    status: matched ? rule.status : "REFERENCE",
  };
}

/**
 * 複数ルールの評価結果を単一のスコア・総合危険度へ集計する関数は意図的に提供しない。
 * 詳細設計仕様書 8.6 の禁止事項: 「複数カードを単純加算して総合危険度を作らない」
 * 「UNKNOWN を数値0として集計しない」「公的ハザード区域と地形由来の観測を同一ラベルで混同しない」。
 * 呼び出し側は CardRuleEvaluationResult[] を個別カードとしてそのまま提示すること。
 */
export function evaluateCardRules(
  rules: readonly CardRule[],
  metrics: MetricSource,
  coverage: Coverage,
): readonly CardRuleEvaluationResult[] {
  return rules.map((rule) => evaluateCardRule(rule, metrics, coverage));
}
