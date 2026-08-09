/**
 * 施工可否判定エンジン (統合: wmcdss backend/app/services/decision.py)。
 *
 * 与えられた観測値と閾値ルールから最悪ケースの go / caution / stop を返す。
 * - 評価できなかったルールが1件でもあれば go にしない (fail-closed)
 * - 欠測は caution まで引き上げる (stop にはしない) — 現場の無視・無効化を防ぐ
 * - 有効期間は判定対象の施工時間帯 (JST暦日) との重なりで判定する
 */

const OPERATORS: Readonly<Record<string, (a: number, b: number) => boolean>> = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

const SEVERITY_ORDER: Readonly<Record<string, number>> = { go: 0, caution: 1, stop: 2 };
const SEVERITY_FROM_THRESHOLD: Readonly<Record<string, "go" | "caution" | "stop">> = {
  warn: "caution",
  stop: "stop",
};

export const UNEVALUATED_MISSING_VALUE = "missing_value";
export const UNEVALUATED_UNKNOWN_OP = "unknown_operator";
export const REASON_ALL_CLEAR = "全しきい値を満たしています。施工可。";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type DecisionStatus = "go" | "caution" | "stop";

export interface ThresholdRule {
  readonly workType: string;
  readonly metric: string;
  readonly op: string;
  readonly value: number;
  readonly severity: "warn" | "stop";
  readonly note?: string | null;
}

export interface DecisionResult {
  readonly status: DecisionStatus;
  readonly reason: string;
  readonly matchedRules: ReadonlyArray<Record<string, unknown>>;
  readonly unevaluatedRules: ReadonlyArray<Record<string, unknown>>;
  readonly evaluatedCount: number;
  readonly outOfEffectRules: ReadonlyArray<Record<string, unknown>>;
}

function asUtc(value: Date): Date {
  return new Date(value.getTime());
}

function jstDate(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * しきい値の有効期間が判定対象の施工時間帯と重なるなら true。
 * 両端 inclusive。NULL は無期限。
 */
export function isRuleInEffect(
  rule: { activeFrom?: Date | null; activeTo?: Date | null },
  windowStart: Date,
  windowEnd: Date,
): boolean {
  const startJst = jstDate(asUtc(windowStart));
  const endJst = jstDate(asUtc(windowEnd));
  if (rule.activeFrom !== null && rule.activeFrom !== undefined) {
    const fromJst = jstDate(rule.activeFrom);
    if (fromJst > endJst) return false;
  }
  if (rule.activeTo !== null && rule.activeTo !== undefined) {
    const toJst = jstDate(rule.activeTo);
    if (toJst < startJst) return false;
  }
  return true;
}

function ruleSnapshot(rule: ThresholdRule, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workType: rule.workType,
    metric: rule.metric,
    op: rule.op,
    value: rule.value,
    severity: rule.severity,
    note: rule.note ?? null,
    ...extra,
  };
}

function atLeastCaution(status: DecisionStatus): DecisionStatus {
  return SEVERITY_ORDER[status] < SEVERITY_ORDER.caution ? "caution" : status;
}

function dedup(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function evaluateDecision(
  options: {
    workType: string;
    inputs: Readonly<Record<string, number | null | undefined>>;
    rules: readonly ThresholdRule[];
    outOfEffect?: readonly Record<string, unknown>[];
  },
): DecisionResult {
  const { workType, inputs, rules, outOfEffect = [] } = options;
  let status: DecisionStatus = "go";
  const reasons: string[] = [];
  const matched: Record<string, unknown>[] = [];
  const unevaluated: Record<string, unknown>[] = [];
  let applicable = 0;

  for (const rule of rules) {
    if (rule.workType !== workType) continue;
    applicable += 1;

    const value = inputs[rule.metric];
    if (value === null || value === undefined) {
      unevaluated.push(ruleSnapshot(rule, { unevaluatedReason: UNEVALUATED_MISSING_VALUE }));
      continue;
    }
    const op = OPERATORS[rule.op];
    if (op === undefined) {
      unevaluated.push(ruleSnapshot(rule, { unevaluatedReason: UNEVALUATED_UNKNOWN_OP }));
      continue;
    }
    if (op(value, rule.value)) {
      const mapped = SEVERITY_FROM_THRESHOLD[rule.severity] ?? "caution";
      if (SEVERITY_ORDER[mapped] > SEVERITY_ORDER[status]) {
        status = mapped;
      }
      let line = `${rule.metric}=${value} が基準 (${rule.op}${rule.value}) に該当 [${rule.severity}]`;
      if (rule.note) {
        line += `  (${rule.note})`;
      }
      reasons.push(line);
      matched.push(ruleSnapshot(rule, { observed: value }));
    }
  }

  const finalized = finalize({
    workType,
    status,
    reasons,
    unevaluated,
    applicable,
    outOfEffect,
  });

  return {
    status: finalized.status,
    reason: finalized.reasons.join("\n"),
    matchedRules: matched,
    unevaluatedRules: unevaluated,
    evaluatedCount: applicable - unevaluated.length,
    outOfEffectRules: outOfEffect,
  };
}

function finalize(options: {
  workType: string;
  status: DecisionStatus;
  reasons: string[];
  unevaluated: ReadonlyArray<Record<string, unknown>>;
  applicable: number;
  outOfEffect: readonly Record<string, unknown>[];
}): { status: DecisionStatus; reasons: string[] } {
  const { workType, status, reasons, unevaluated, applicable, outOfEffect } = options;

  if (applicable === 0) {
    if (outOfEffect.length > 0) {
      reasons.push(
        `作業種別「${workType}」のしきい値は ${outOfEffect.length} 件設定されていますが、いずれも判定対象期間には有効ではありません（有効期間外）。判定根拠が無いため施工可とは判定できません。しきい値の有効期間を確認してください。`,
      );
    } else {
      reasons.push(
        `作業種別「${workType}」に対するしきい値が 1 件も設定されていません。判定根拠が無いため施工可とは判定できません。しきい値を設定してください。`,
      );
    }
    return { status: atLeastCaution(status), reasons };
  }

  if (unevaluated.length > 0) {
    const missing = dedup(
      unevaluated
        .filter((u) => u.unevaluatedReason === UNEVALUATED_MISSING_VALUE)
        .map((u) => String(u.metric)),
    );
    const badOp = dedup(
      unevaluated
        .filter((u) => u.unevaluatedReason === UNEVALUATED_UNKNOWN_OP)
        .map((u) => `${u.metric}(${u.op})`),
    );
    if (missing.length > 0) {
      reasons.push(
        `観測値が取得できないため評価できないしきい値があります: ${missing.join(", ")}。欠測のため施工可とは判定できません。現地確認のうえ判断してください。`,
      );
    }
    if (badOp.length > 0) {
      reasons.push(`比較演算子が不正なしきい値があります: ${badOp.join(", ")}。設定を修正するまでこのルールは評価されません。`);
    }
    return { status: atLeastCaution(status), reasons };
  }

  if (status === "go") {
    reasons.push(REASON_ALL_CLEAR);
  }
  return { status, reasons };
}
