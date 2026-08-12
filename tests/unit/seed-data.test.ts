import { describe, expect, test } from "vitest";
import { PROVIDERS, SOURCES } from "../../prisma/seed-data";

describe("データソースシードの整合性", () => {
  test("全ソースが必須フィールドを持つ", () => {
    for (const source of SOURCES) {
      expect(source.name.trim().length).toBeGreaterThan(0);
      expect(source.description.trim().length).toBeGreaterThan(0);
      expect(source.officialUrl.startsWith("https://")).toBe(true);
      expect(["CSV", "GeoJSON", "JSON", "XML", "PNG", "PDF", "HTML", "Shapefile", "CityGML", "other", "tile"].includes(source.dataFormat)).toBe(true);
      expect(["allowed", "restricted", "unknown"]).toContain(source.commercialUse);
      expect(Array.isArray(source.tags)).toBe(true);
      expect(Array.isArray(source.useCases)).toBe(true);
      expect(source.trustLevel).toBeGreaterThanOrEqual(1);
      expect(source.trustLevel).toBeLessThanOrEqual(5);
      expect(source.qualityScore).toBeGreaterThanOrEqual(0);
      expect(source.qualityScore).toBeLessThanOrEqual(100);
    }
  });

  test("officialUrl が重複しない", () => {
    const seen = new Map<string, string>();
    for (const source of SOURCES) {
      const key = source.officialUrl;
      expect(seen.has(key)).toBe(false);
      seen.set(key, source.name);
    }
  });

  test("providerName が PROVIDERS に存在する", () => {
    const providerNames = new Set(PROVIDERS.map((provider) => provider.name));
    for (const source of SOURCES) {
      expect(providerNames.has(source.providerName), `${source.name} の providerName=${source.providerName}`).toBe(true);
    }
  });

  test("APIキー不要かつ JSON/CSV/GeoJSON/XML の公式ソースが50種以上ある（実データ50種マイルストーン）", () => {
    const eligible = SOURCES.filter(
      (source) =>
        !source.requiresApiKey &&
        ["JSON", "CSV", "GeoJSON", "XML"].includes(source.dataFormat) &&
        Boolean(source.endpointUrl),
    );
    expect(eligible.length).toBeGreaterThanOrEqual(50);
  });

  test("2026-08-12 追加分のエンドポイントが重複しない", () => {
    const seen = new Set<string>();
    for (const source of SOURCES) {
      if (source.endpointUrl) {
        expect(seen.has(source.endpointUrl), `${source.name} の endpointUrl 重複`).toBe(false);
        seen.add(source.endpointUrl);
      }
    }
  });
});
