import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateDecision } from "@/lib/decision/engine";
import type { ThresholdRule } from "@/lib/decision/engine";

/**
 * Golden Dataset テスト (Gate 2)。
 *
 * 既知入力 → 期待結果 を testdata/golden の versioned dataset で固定し、
 * 判定エンジンの fail-closed 仕様が知らないうちに変わらないようにする。
 * 期待値の変更は docs/quality/TEST_EVIDENCE.md の変更履歴に記録すること。
 */

const datasetPath = path.resolve(
  import.meta.dirname,
  "../../testdata/golden/decision-engine-golden.json",
);

type GoldenCase = {
  id: string;
  description: string;
  input: {
    workType: string;
    inputs: Record<string, number | null>;
    rules: Array<Partial<ThresholdRule> & Pick<ThresholdRule, "metric" | "op" | "value" | "severity">>;
    outOfEffectCount?: number;
  };
  expected: {
    status: "go" | "caution" | "stop";
    evaluatedCount: number;
    matchedRulesCount: number;
    unevaluatedRulesCount: number;
    reasonContains: string[];
  };
};

const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as {
  datasetId: string;
  datasetVersion: string;
  cases: GoldenCase[];
};

describe("decision engine golden dataset", () => {
  it("is versioned and non-empty", () => {
    expect(dataset.datasetId).toBe("decision-engine-golden");
    expect(dataset.datasetVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dataset.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of dataset.cases) {
    it(`${testCase.id}: ${testCase.description}`, () => {
      const rules: ThresholdRule[] = testCase.input.rules.map((rule) => ({
        ...rule,
        workType: rule.workType ?? testCase.input.workType,
      }));
      const result = evaluateDecision({
        workType: testCase.input.workType,
        inputs: testCase.input.inputs,
        rules,
        outOfEffect:
          testCase.input.outOfEffectCount !== undefined
            ? Array.from({ length: testCase.input.outOfEffectCount }, () => ({}))
            : [],
      });

      expect(result.status).toBe(testCase.expected.status);
      expect(result.evaluatedCount).toBe(testCase.expected.evaluatedCount);
      expect(result.matchedRules).toHaveLength(testCase.expected.matchedRulesCount);
      expect(result.unevaluatedRules).toHaveLength(
        testCase.expected.unevaluatedRulesCount,
      );
      for (const fragment of testCase.expected.reasonContains) {
        expect(result.reason).toContain(fragment);
      }
    });
  }
});
