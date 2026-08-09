import { describe, expect, it } from "vitest";
import { evaluateCardRule, evaluateCardRules, type CardRule } from "@/lib/terrain/domain";

const steepSlopeRule: CardRule = {
  ruleId: "steep-slope-observed",
  when: { metric: "slope.maxDeg", gte: 30 },
  status: "CHECK_REQUIRED",
  requires: ["quality.coverage != NONE"],
  evidence: ["dem", "slope_algorithm"],
};

describe("evaluateCardRule", () => {
  it("returns CHECK_REQUIRED when the metric meets the threshold", () => {
    const result = evaluateCardRule(steepSlopeRule, { "slope.maxDeg": 31.2 }, "FULL");
    expect(result).toEqual({
      ruleId: "steep-slope-observed",
      matched: true,
      status: "CHECK_REQUIRED",
    });
  });

  it("returns REFERENCE when the metric is just below the threshold", () => {
    const result = evaluateCardRule(steepSlopeRule, { "slope.maxDeg": 29.999 }, "FULL");
    expect(result.status).toBe("REFERENCE");
    expect(result.matched).toBe(false);
  });

  it("treats the boundary value as matching (inclusive gte)", () => {
    const result = evaluateCardRule(steepSlopeRule, { "slope.maxDeg": 30 }, "FULL");
    expect(result.matched).toBe(true);
    expect(result.status).toBe("CHECK_REQUIRED");
  });

  it("returns UNKNOWN when coverage is NONE, never REFERENCE (Unknown is not Safe)", () => {
    const result = evaluateCardRule(steepSlopeRule, { "slope.maxDeg": 5 }, "NONE");
    expect(result.status).toBe("UNKNOWN");
  });

  it("returns UNKNOWN when the referenced metric itself is missing", () => {
    const result = evaluateCardRule(steepSlopeRule, {}, "FULL");
    expect(result.status).toBe("UNKNOWN");
  });

  it("does not conflate a missing metric with a numeric zero", () => {
    const missing = evaluateCardRule(steepSlopeRule, {}, "FULL");
    const zero = evaluateCardRule(steepSlopeRule, { "slope.maxDeg": 0 }, "FULL");
    expect(missing.status).toBe("UNKNOWN");
    expect(zero.status).toBe("REFERENCE");
  });

  it("returns UNKNOWN when the metric is NaN, never REFERENCE (Unknown is not Safe)", () => {
    const result = evaluateCardRule(steepSlopeRule, { "slope.maxDeg": Number.NaN }, "FULL");
    expect(result.status).toBe("UNKNOWN");
    expect(result.matched).toBe(true);
  });

  it("returns UNKNOWN for non-finite metrics (±Infinity)", () => {
    const positive = evaluateCardRule(
      steepSlopeRule,
      { "slope.maxDeg": Number.POSITIVE_INFINITY },
      "FULL",
    );
    const negative = evaluateCardRule(
      steepSlopeRule,
      { "slope.maxDeg": Number.NEGATIVE_INFINITY },
      "FULL",
    );
    expect(positive.status).toBe("UNKNOWN");
    expect(negative.status).toBe("UNKNOWN");
  });
});

describe("evaluateCardRules", () => {
  it("evaluates each rule independently without aggregating into a single score", () => {
    const results = evaluateCardRules(
      [
        steepSlopeRule,
        {
          ...steepSlopeRule,
          ruleId: "steep-slope-strict",
          when: { metric: "slope.maxDeg", gte: 45 },
        },
      ],
      { "slope.maxDeg": 31.2 },
      "FULL",
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe("CHECK_REQUIRED");
    expect(results[1]?.status).toBe("REFERENCE");
  });
});
