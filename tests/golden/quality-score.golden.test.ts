import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeTotalScore, deriveQualityScores } from "@/lib/quality";
import type { QualityInput, QualityScores } from "@/lib/quality";

/**
 * Golden Dataset テスト (Gate 2): 品質スコアの配点 (docs/08-data-quality-policy.md §3)
 * を既知入力 → 期待値で固定する。数値は TOLERANCE_SPEC.md 2.2 により exact 判定。
 */

const datasetPath = path.resolve(
  import.meta.dirname,
  "../../testdata/golden/quality-score-golden.json",
);

type Variant = Partial<QualityInput> & { lastCheckedAt?: string | null };
type GoldenCase = {
  id: string;
  description: string;
  input: Omit<Partial<QualityInput>, "lastCheckedAt"> & {
    lastCheckedAt?: string | null;
    scoresInput?: Partial<QualityScores>;
    variants?: Variant[];
    /** 判定を決定論化するための固定現在時刻 (ISO 文字列) */
    now?: string;
  };
  expected: {
    scores?: Partial<QualityScores>;
    total?: number;
    variantsOnly?: boolean;
  };
};

const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as {
  datasetId: string;
  datasetVersion: string;
  cases: GoldenCase[];
};

type MergedInput = GoldenCase["input"] & Variant & { now?: string };

function toQualityInput(base: GoldenCase["input"], variant?: Variant): QualityInput {
  const merged = { ...base, ...variant } as MergedInput;
  const lastCheckedAt =
    typeof merged.lastCheckedAt === "string" ? new Date(merged.lastCheckedAt) : merged.lastCheckedAt ?? null;
  return {
    organizationType: merged.organizationType ?? "other",
    lastCheckedAt,
    successCount: merged.successCount ?? 0,
    failureCount: merged.failureCount ?? 0,
    licenseName: merged.licenseName ?? null,
    commercialUse: merged.commercialUse ?? "unknown",
    dataFormat: merged.dataFormat ?? "other",
    category: merged.category ?? "other",
    staleDays: merged.staleDays,
  };
}

/** dataset の now を固定時刻として使い、実時刻に依存しない決定論的な判定にする */
function fixedNow(base: GoldenCase["input"]): Date {
  return base.now ? new Date(base.now) : new Date(0);
}

describe("quality score golden dataset", () => {
  const SCORE_KEYS: ReadonlyArray<keyof QualityScores> = [
    "officialSourceScore",
    "freshnessScore",
    "accessibilityScore",
    "licenseClarityScore",
    "formatUsabilityScore",
    "constructionRelevanceScore",
  ];

  it("is versioned and non-empty", () => {
    expect(dataset.datasetId).toBe("quality-score-golden");
    expect(dataset.datasetVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dataset.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of dataset.cases) {
    it(`${testCase.id}: ${testCase.description}`, () => {
      if (testCase.input.scoresInput) {
        const scores = testCase.input.scoresInput as QualityScores;
        expect(computeTotalScore(scores)).toBe(testCase.expected.total);
        return;
      }
      if (testCase.expected.variantsOnly) {
        for (const variant of testCase.input.variants ?? []) {
          const scores = deriveQualityScores(
            toQualityInput(testCase.input, variant),
            fixedNow(testCase.input),
          );
          for (const key of SCORE_KEYS) {
            const expectedVariant = variant as unknown as Record<string, unknown>;
            if (expectedVariant[key] !== undefined) {
              expect(scores[key]).toBe(expectedVariant[key]);
            }
          }
        }
        return;
      }
      const base = { ...testCase.input } as GoldenCase["input"];
      const variant = (base.variants ?? [])[0];
      const scores = deriveQualityScores(
        toQualityInput(base, variant),
        fixedNow(base),
      );
      for (const [key, value] of Object.entries(testCase.expected.scores ?? {})) {
        expect(scores[key as keyof QualityScores]).toBe(value);
      }
      expect(computeTotalScore(scores)).toBe(testCase.expected.total);
    });
  }
});
