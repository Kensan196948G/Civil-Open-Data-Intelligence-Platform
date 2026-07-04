import { describe, expect, it } from "vitest";
import { computeTotalScore, deriveQualityScores } from "@/lib/quality";

describe("computeTotalScore", () => {
  it("満点は100になる", () => {
    expect(
      computeTotalScore({
        officialSourceScore: 20,
        freshnessScore: 15,
        accessibilityScore: 15,
        licenseClarityScore: 15,
        formatUsabilityScore: 15,
        constructionRelevanceScore: 20,
      }),
    ).toBe(100);
  });

  it("配点上限を超えるサブスコアは丸められる", () => {
    expect(
      computeTotalScore({
        officialSourceScore: 100,
        freshnessScore: 100,
        accessibilityScore: 100,
        licenseClarityScore: 100,
        formatUsabilityScore: 100,
        constructionRelevanceScore: 100,
      }),
    ).toBe(100);
  });

  it("負のサブスコアは0に丸められる", () => {
    expect(
      computeTotalScore({
        officialSourceScore: -5,
        freshnessScore: 0,
        accessibilityScore: 0,
        licenseClarityScore: 0,
        formatUsabilityScore: 0,
        constructionRelevanceScore: 0,
      }),
    ).toBe(0);
  });
});

describe("deriveQualityScores", () => {
  const now = new Date("2026-07-04T00:00:00Z");

  it("国の公式・直近確認・高成功率・条件明確・JSON・道路カテゴリは高評価", () => {
    const scores = deriveQualityScores(
      {
        organizationType: "national",
        lastCheckedAt: new Date("2026-07-01T00:00:00Z"),
        successCount: 20,
        failureCount: 0,
        licenseName: "政府標準利用規約",
        commercialUse: "allowed",
        dataFormat: "JSON",
        category: "road",
      },
      now,
    );
    expect(scores.officialSourceScore).toBe(20);
    expect(scores.freshnessScore).toBe(15);
    expect(scores.accessibilityScore).toBe(15);
    expect(scores.licenseClarityScore).toBe(15);
    expect(scores.formatUsabilityScore).toBe(15);
    expect(scores.constructionRelevanceScore).toBe(20);
    expect(computeTotalScore(scores)).toBe(100);
  });

  it("未確認・ログなし・ライセンス不明は低評価", () => {
    const scores = deriveQualityScores(
      {
        organizationType: "community",
        lastCheckedAt: null,
        successCount: 0,
        failureCount: 0,
        licenseName: null,
        commercialUse: "unknown",
        dataFormat: "PDF",
        category: "research",
      },
      now,
    );
    expect(scores.freshnessScore).toBe(3);
    expect(scores.accessibilityScore).toBe(5);
    expect(scores.licenseClarityScore).toBe(0);
    expect(computeTotalScore(scores)).toBeLessThan(40);
  });

  it("接続失敗が多いと接続安定性が下がる", () => {
    const scores = deriveQualityScores(
      {
        organizationType: "national",
        lastCheckedAt: new Date("2026-07-03T00:00:00Z"),
        successCount: 1,
        failureCount: 9,
        licenseName: "x",
        commercialUse: "allowed",
        dataFormat: "JSON",
        category: "gis",
      },
      now,
    );
    expect(scores.accessibilityScore).toBe(3);
  });

  it("90日超の未確認は鮮度が最低になる", () => {
    const scores = deriveQualityScores(
      {
        organizationType: "national",
        lastCheckedAt: new Date("2026-01-01T00:00:00Z"),
        successCount: 1,
        failureCount: 0,
        licenseName: "x",
        commercialUse: "allowed",
        dataFormat: "JSON",
        category: "gis",
      },
      now,
    );
    expect(scores.freshnessScore).toBe(3);
  });
});
