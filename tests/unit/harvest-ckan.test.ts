import { describe, expect, it } from "vitest";
import {
  buildSourceFromPackage,
  normalizeFormat,
  selectPreferredResource,
} from "../../scripts/ingestion/harvest-ckan";

const NOW = new Date("2026-08-12T03:00:00Z");

describe("harvest-ckan", () => {
  it("normalizes formats", () => {
    expect(normalizeFormat("json")).toBe("JSON");
    expect(normalizeFormat("CSV")).toBe("CSV");
    expect(normalizeFormat("application/geo+json")).toBe("APPLICATION/GEO+JSON");
    expect(normalizeFormat("")).toBe("other");
  });

  it("prefers JSON/CSV/GeoJSON/XML https resources", () => {
    const resources = [
      { format: "PDF", url: "https://example.org/a.pdf" },
      { format: "CSV", url: "https://example.org/a.csv" },
      { format: "GeoJSON", url: "https://example.org/a.geojson" },
    ];
    expect(selectPreferredResource(resources)).toEqual({
      url: "https://example.org/a.geojson",
      format: "GeoJSON",
    });
    expect(selectPreferredResource([{ format: "PDF", url: "http://insecure.example/a.pdf" }])).toBeNull();
  });

  it("builds a source entry from a CKAN package", () => {
    const source = buildSourceFromPackage(
      {
        id: "pkg-1",
        name: "river-level-tokyo",
        title: "東京都 河川水位",
        notes: "<p>河川水位の観測データ</p>",
        license_title: "CC BY 4.0",
        resources: [{ format: "CSV", url: "https://data.bodik.jp/river.csv" }],
      },
      "https://data.bodik.jp",
      "BODIK(オープンデータ推進)",
      NOW,
    );
    expect(source).toMatchObject({
      providerName: "BODIK(オープンデータ推進)",
      name: "東京都 河川水位",
      officialUrl: "https://data.bodik.jp/river.csv",
      endpointUrl: "https://data.bodik.jp/river.csv",
      dataFormat: "CSV",
      commercialUse: "restricted",
      licenseName: "CC BY 4.0",
    });
    expect(source?.note).toContain("2026-08-12T03:00:00.000Z");
    expect(source?.description).not.toContain("<p>");
  });

  it("drops packages without a usable https resource or dataset url", () => {
    const source = buildSourceFromPackage(
      { id: "pkg-2", name: "no-resource", title: "空", resources: [] },
      "https://data.bodik.jp",
      "BODIK(オープンデータ推進)",
      NOW,
    );
    expect(source?.officialUrl).toContain("https://data.bodik.jp/dataset/no-resource");
  });
});
