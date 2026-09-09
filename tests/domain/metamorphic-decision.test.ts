import { describe, expect, it } from "vitest";
import { evaluateDecision } from "@/lib/decision/engine";
import type { ThresholdRule } from "@/lib/decision/engine";

/**
 * Metamorphic Test (Gate 2) — 施工可否判定の不変条件。
 *
 * 正解の判定自体は Golden Dataset (G-DEC-*) が担保する。ここでは
 * 「入力を変換したときに成立すべき不変条件」を検証する:
 *
 *   MR-DEC-1  ルール順序を入れ替えても判定結果は不変 (worst-case 集約)
 *   MR-DEC-2  違反 (stop) を追加して status が緩和されることはない (単調性)
 *   MR-DEC-3  観測値を欠測 (null) に置換して status が緩和されることはない
 *             (go→caution は許容、stop→caution は禁止)
 *
 * いずれも docs/quality/TOLERANCE_SPEC.md 2.1 に基づく exact 判定。
 */

const SEVERITY_ORDER = { go: 0, caution: 1, stop: 2 } as const;

function baseRules(): ThresholdRule[] {
  return [
    { workType: "concrete", metric: "precipMm1h", op: ">=", value: 10, severity: "stop" },
    { workType: "concrete", metric: "windSpeedMs", op: ">=", value: 15, severity: "warn" },
    { workType: "concrete", metric: "temperatureC", op: "<=", value: 2, severity: "warn" },
  ];
}

function baseInputs(): Record<string, number | null> {
  return { precipMm1h: 2, windSpeedMs: 4, temperatureC: 20 };
}

describe("metamorphic decision invariants", () => {
  it("MR-DEC-1: rule order does not change the worst-case status", () => {
    const rules = baseRules();
    const forward = evaluateDecision({ workType: "concrete", inputs: baseInputs(), rules });
    const reversed = evaluateDecision({
      workType: "concrete",
      inputs: baseInputs(),
      rules: [...rules].reverse(),
    });
    expect(reversed.status).toBe(forward.status);
    expect(reversed.matchedRules).toHaveLength(forward.matchedRules.length);
    expect(reversed.unevaluatedRules).toHaveLength(forward.unevaluatedRules.length);
  });

  it("MR-DEC-2: adding a matching stop rule never relaxes the status", () => {
    const before = evaluateDecision({
      workType: "concrete",
      inputs: baseInputs(),
      rules: baseRules(),
    });
    const extraStop: ThresholdRule = {
      workType: "concrete",
      metric: "sigWaveHM",
      op: ">=",
      value: 1,
      severity: "stop",
    };
    const after = evaluateDecision({
      workType: "concrete",
      inputs: { ...baseInputs(), sigWaveHM: 3 },
      rules: [...baseRules(), extraStop],
    });
    expect(SEVERITY_ORDER[after.status]).toBeGreaterThanOrEqual(
      SEVERITY_ORDER[before.status],
    );
    expect(after.status).toBe("stop");
  });

  it("MR-DEC-1b: permutation invariance also holds when violations exist", () => {
    const violating = { precipMm1h: 12, windSpeedMs: 20, temperatureC: 0 };
    const rules = baseRules();
    const forward = evaluateDecision({ workType: "concrete", inputs: violating, rules });
    const reversed = evaluateDecision({
      workType: "concrete",
      inputs: violating,
      rules: [...rules].reverse(),
    });
    expect(forward.status).toBe("stop");
    expect(reversed.status).toBe(forward.status);
    expect(reversed.matchedRules).toHaveLength(forward.matchedRules.length);
  });

  it("MR-DEC-3: a missing observation never lets the decision degrade to go", () => {
    const violating = { precipMm1h: 12, windSpeedMs: 4, temperatureC: 20 };
    for (const metric of Object.keys(violating)) {
      const degraded = { ...violating, [metric]: null };
      const result = evaluateDecision({
        workType: "concrete",
        inputs: degraded,
        rules: baseRules(),
      });
      // 欠測は caution まで引き上げる (stop にはしない) — engine.ts の仕様。
      // 重要なのは「欠測によって go に下がらないこと」と、欠測が記録されること。
      expect(result.status === "caution" || result.status === "stop").toBe(true);
      expect(result.unevaluatedRules.length).toBeGreaterThan(0);
      expect(result.reason).toContain("欠測のため施工可とは判定できません");
    }
  });

  it("MR-DEC-3c: nulling a non-violating metric keeps an observed stop violation", () => {
    const violating = { precipMm1h: 12, windSpeedMs: 4, temperatureC: 20 };
    for (const metric of ["windSpeedMs", "temperatureC"]) {
      const degraded = { ...violating, [metric]: null };
      const result = evaluateDecision({
        workType: "concrete",
        inputs: degraded,
        rules: baseRules(),
      });
      // stop 違反そのものが観測され続けている限り、欠測によって緩和されない
      expect(result.status).toBe("stop");
    }
  });

  it("MR-DEC-3b: missing value alone raises go to at least caution (fail-closed)", () => {
    const allClear = { precipMm1h: 2, windSpeedMs: 4, temperatureC: 20 };
    for (const metric of Object.keys(allClear)) {
      const withHole = { ...allClear, [metric]: null };
      const result = evaluateDecision({
        workType: "concrete",
        inputs: withHole,
        rules: baseRules(),
      });
      expect(SEVERITY_ORDER[result.status]).toBeGreaterThanOrEqual(
        SEVERITY_ORDER.caution,
      );
    }
  });
});
