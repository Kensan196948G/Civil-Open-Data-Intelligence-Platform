import { describe, expect, it } from "vitest";
import { scoreDataSources, type RecommendationCandidate } from "@/lib/recommendations";

const base: RecommendationCandidate = {
  id: "src_1",
  name: "国土数値情報 浸水想定区域",
  nameEn: "flood",
  description: "洪水・浸水リスクを確認できるデータ",
  category: "disaster",
  dataFormat: "GeoJSON",
  accessType: "download",
  officialUrl: "https://nlftp.mlit.go.jp/ksj/",
  documentationUrl: null,
  endpointUrl: null,
  licenseName: "国土数値情報利用約款",
  commercialUse: "allowed",
  updateFrequency: "monthly",
  lastCheckedAt: new Date("2026-08-01T00:00:00Z"),
  status: "active",
  qualityScore: 85,
  tags: [{ tag: { id: "t1", name: "防災", color: "#ef4444" } }],
  relatedUseCases: [{ useCaseName: "浸水リスク確認", targetSystem: "Civil Weather Disaster Watch", description: null }],
};

describe("rule-based recommendations", () => {
  it("scores and ranks by keyword/tag/use-case", () => {
    const result = scoreDataSources(
      [
        base,
        { ...base, id: "src_2", name: "気象庁XML", category: "weather", qualityScore: 70, tags: [] },
      ],
      "横浜 浸水",
      5,
    );
    expect(result[0].sourceId).toBe("src_1");
    expect(result[0].reasons.length).toBeGreaterThan(0);
    expect(result[0].mapLayerUrl).toBe("/api/v1/layers/src_1/features");
  });

  it("returns empty when nothing matches", () => {
    expect(scoreDataSources([base], "全く無関係な語彙XYZ", 5)).toHaveLength(0);
  });
});
