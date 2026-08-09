import { describe, expect, it } from "vitest";
import {
  REASON_ALL_CLEAR,
  UNEVALUATED_MISSING_VALUE,
  evaluateDecision,
  isRuleInEffect,
} from "@/lib/decision/engine";
import type { ThresholdRule } from "@/lib/decision/engine";

const rainStop: ThresholdRule = {
  workType: "concrete",
  metric: "precipMm1h",
  op: ">=",
  value: 10,
  severity: "stop",
  note: "1時間降雨 10mm 以上で中止推奨",
};

describe("evaluateDecision", () => {
  it("returns go with the canonical reason when all rules pass", () => {
    const result = evaluateDecision({
      workType: "concrete",
      inputs: { precipMm1h: 2, temperatureC: 22 },
      rules: [rainStop],
    });
    expect(result.status).toBe("go");
    expect(result.reason).toContain(REASON_ALL_CLEAR);
    expect(result.evaluatedCount).toBe(1);
  });

  it("returns stop when a stop threshold matches", () => {
    const result = evaluateDecision({
      workType: "concrete",
      inputs: { precipMm1h: 12 },
      rules: [rainStop],
    });
    expect(result.status).toBe("stop");
    expect(result.matchedRules.length).toBe(1);
    expect(result.reason).toContain("1時間降雨 10mm 以上で中止推奨");
  });

  it("never returns go when a value is missing (fail-closed)", () => {
    const result = evaluateDecision({
      workType: "concrete",
      inputs: { precipMm1h: null },
      rules: [rainStop],
    });
    expect(result.status).toBe("caution");
    expect(result.unevaluatedRules[0]?.unevaluatedReason).toBe(UNEVALUATED_MISSING_VALUE);
    expect(result.reason).toContain("施工可とは判定できません");
  });

  it("does not return go when no rules exist", () => {
    const result = evaluateDecision({ workType: "crane", inputs: {}, rules: [] });
    expect(result.status).toBe("caution");
    expect(result.reason).toContain("1 件も設定されていません");
  });

  it("distinguishes out-of-effect rules from unset rules", () => {
    const result = evaluateDecision({
      workType: "concrete",
      inputs: { precipMm1h: 1 },
      rules: [],
      outOfEffect: [{ workType: "concrete", metric: "precipMm1h" }],
    });
    expect(result.reason).toContain("有効期間外");
  });
});

describe("isRuleInEffect", () => {
  it("treats null dates as unlimited", () => {
    expect(isRuleInEffect({}, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T01:00:00Z"))).toBe(true);
  });

  it("checks overlap with the JST calendar day", () => {
    // activeTo 2026-01-31 is inclusive; window on 2026-01-31 JST must match
    const activeTo = new Date("2026-01-31T00:00:00Z");
    const windowStart = new Date("2026-01-31T00:00:00Z");
    const windowEnd = new Date("2026-01-31T10:00:00Z");
    expect(isRuleInEffect({ activeTo }, windowStart, windowEnd)).toBe(true);
  });
});
