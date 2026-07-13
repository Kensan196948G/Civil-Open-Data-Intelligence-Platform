import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const findManyMock = vi.hoisted(() => vi.fn());
const countMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const findFirstMock = vi.hoisted(() => vi.fn());
const fetchLogFindManyMock = vi.hoisted(() => vi.fn());
const fetchLogFindFirstMock = vi.hoisted(() => vi.fn());
const fetchLogCountMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    dataSource: {
      findMany: findManyMock,
      count: countMock,
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
    },
    fetchLog: {
      findMany: fetchLogFindManyMock,
      findFirst: fetchLogFindFirstMock,
      count: fetchLogCountMock,
    },
  },
}));

import { GET as searchGET } from "@/app/api/v1/records/search/route";
import { GET as pointGET } from "@/app/api/v1/records/point/route";
import { GET as freshnessGET } from "@/app/api/v1/sources/[id]/freshness/route";
import { GET as layersGET } from "@/app/api/v1/layers/route";
import { GET as layerFeaturesGET } from "@/app/api/v1/layers/[id]/features/route";

const source = {
  id: "src_1",
  name: "国土数値情報",
  nameEn: null,
  description: "国土・都市計画等の公開データ",
  officialUrl: "https://nlftp.mlit.go.jp/ksj/",
  endpointUrl: null,
  documentationUrl: "https://nlftp.mlit.go.jp/ksj/",
  category: "gis",
  dataFormat: "GeoJSON",
  accessType: "download",
  requiresApiKey: false,
  licenseName: "国土数値情報利用約款",
  commercialUse: "allowed",
  attributionRequired: true,
  updateFrequency: "monthly",
  lastCheckedAt: new Date("2026-07-01T00:00:00.000Z"),
  status: "active",
  trustLevel: 5,
  qualityScore: 85,
  note: null,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  provider: {
    id: "provider_1",
    name: "国土交通省",
    organizationType: "national",
    officialUrl: "https://www.mlit.go.jp/",
  },
  tags: [{ tag: { id: "tag_1", name: "GIS", color: "#2563eb" } }],
};

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("v1 downstream API routes", () => {
  it("returns data source catalog entries as standard-record-shaped metadata", async () => {
    findManyMock.mockResolvedValueOnce([source]);
    countMock.mockResolvedValueOnce(1);

    const response = await searchGET(new NextRequest("http://localhost/api/v1/records/search?limit=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.records).toHaveLength(1);
    expect(body.data.records[0]).toMatchObject({
      recordId: "catalog:src_1",
      sourceId: "src_1",
      title: "国土数値情報",
      sourceUrl: "https://nlftp.mlit.go.jp/ksj/",
      licenseId: "国土数値情報利用約款",
      qualityStatus: "usable",
      properties: {
        provider: { name: "国土交通省" },
        dataFormat: "GeoJSON",
        qualityScore: 85,
      },
    });
    expect(body.meta.requestId).toMatch(/^req_/);
    expect(body.meta.sourceCount).toBe(1);
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "catalog_metadata_only", severity: "info" }),
        expect.objectContaining({ code: "decision_not_supported", severity: "warning" }),
      ]),
    );
  });

  it("rejects invalid v1 search parameters", async () => {
    const response = await searchGET(new NextRequest("http://localhost/api/v1/records/search?q=a"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("does not use internal notes as public v1 search fields", async () => {
    findManyMock.mockResolvedValueOnce([]);
    countMock.mockResolvedValueOnce(0);

    const response = await searchGET(new NextRequest("http://localhost/api/v1/records/search?q=internal-note"));

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "internal-note" } },
            { nameEn: { contains: "internal-note" } },
            { description: { contains: "internal-note" } },
          ],
        },
      }),
    );
  });

  it("returns point query metadata and candidate layers without claiming spatial evaluation", async () => {
    findManyMock.mockResolvedValueOnce([source]);

    const response = await pointGET(
      new NextRequest("http://localhost/api/v1/records/point?lat=35.681236&lng=139.767125&radiusM=1000"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      point: { lat: 35.681236, lng: 139.767125, radiusM: 1000 },
      records: [],
      spatialEvaluation: {
        status: "not_available",
        evaluated: false,
        reason: "standard_records_not_ingested",
      },
      dataAvailability: "catalog_only",
      geometryStatus: "not_standardized",
    });
    expect(body.data.candidateLayers[0]).toMatchObject({
      layerId: "src_1",
      geometryStatus: "not_standardized",
      featuresUrl: "/api/v1/layers/src_1/features",
    });
    expect(body.warnings[0]).toMatchObject({ code: "not_standardized", severity: "info" });
  });

  it("rejects invalid point query coordinates", async () => {
    const response = await pointGET(new NextRequest("http://localhost/api/v1/records/point?lat=100&lng=139"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rejects blank point query coordinates", async () => {
    const response = await pointGET(new NextRequest("http://localhost/api/v1/records/point?lat=%20&lng=139"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rejects invalid point query radius instead of silently using the default", async () => {
    const response = await pointGET(new NextRequest("http://localhost/api/v1/records/point?lat=35&lng=139&radiusM=-1"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(body.error.message).toContain("radiusM");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("trims point query categories and applies them only to candidate layers", async () => {
    findManyMock.mockResolvedValueOnce([source]);

    const response = await pointGET(
      new NextRequest("http://localhost/api/v1/records/point?lat=35&lng=139&categories=gis,%20road"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: { in: ["gis", "road"] } }),
      }),
    );
    expect(body.data.point.radiusM).toBe(1000);
    expect(body.data.records).toEqual([]);
    expect(body.data.spatialEvaluation.evaluated).toBe(false);
  });

  it("rejects too many point query categories", async () => {
    const categories = Array.from({ length: 21 }, (_, index) => `cat${index}`).join(",");
    const response = await pointGET(new NextRequest(`http://localhost/api/v1/records/point?lat=35&lng=139&categories=${categories}`));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(body.error.message).toContain("categories");
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("returns source freshness metadata for downstream systems", async () => {
    findUniqueMock.mockResolvedValueOnce(source);
    fetchLogFindFirstMock
      .mockResolvedValueOnce({ success: true, executedAt: new Date("2026-07-02T00:00:00.000Z") })
      .mockResolvedValueOnce({ success: false, executedAt: new Date("2026-07-03T00:00:00.000Z") });
    fetchLogCountMock.mockResolvedValueOnce(1);

    const response = await freshnessGET(
      new NextRequest("http://localhost/api/v1/sources/src_1/freshness"),
      { params: Promise.resolve({ id: "src_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      sourceId: "src_1",
      title: "国土数値情報",
      qualityStatus: "usable",
      lastCheckedAt: "2026-07-01T00:00:00.000Z",
      lastSuccessAt: "2026-07-02T00:00:00.000Z",
      lastFailureAt: "2026-07-03T00:00:00.000Z",
      consecutiveFailureCount: 1,
    });
    expect(body.meta.sourceCount).toBe(1);
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "freshness_metadata_only", severity: "info", sourceId: "src_1" }),
        expect.objectContaining({ code: "decision_not_supported", severity: "warning", sourceId: "src_1" }),
      ]),
    );
    expect(fetchLogCountMock).toHaveBeenCalledWith({
      where: {
        dataSourceId: "src_1",
        success: false,
        executedAt: { gt: new Date("2026-07-02T00:00:00.000Z") },
      },
    });
  });

  it("returns layer catalog metadata for geospatial data sources", async () => {
    findManyMock.mockResolvedValueOnce([source]);
    countMock.mockResolvedValueOnce(1);

    const response = await layersGET(new NextRequest("http://localhost/api/v1/layers?limit=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.layers).toHaveLength(1);
    expect(body.data.layers[0]).toMatchObject({
      layerId: "src_1",
      sourceId: "src_1",
      title: "国土数値情報",
      dataFormat: "GeoJSON",
      featuresUrl: "/api/v1/layers/src_1/features",
      qualityScore: 85,
      status: "active",
      dataAvailability: "catalog_only",
      geometryStatus: "not_standardized",
      featureCount: null,
      capabilities: {
        format: "geojson",
        standardizedFeatures: false,
      },
    });
    expect(body.meta.mode).toBe("catalog_layer_metadata");
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "catalog_metadata_only", severity: "info" }),
        expect.objectContaining({ code: "decision_not_supported", severity: "warning" }),
      ]),
    );
  });

  it("does not use internal notes as public v1 layer search fields", async () => {
    findManyMock.mockResolvedValueOnce([]);
    countMock.mockResolvedValueOnce(0);

    const response = await layersGET(new NextRequest("http://localhost/api/v1/layers?q=internal-note"));

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { name: { contains: "internal-note" } },
                { nameEn: { contains: "internal-note" } },
                { description: { contains: "internal-note" } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it("returns an empty GeoJSON FeatureCollection when standardized features are not ingested yet", async () => {
    findFirstMock.mockResolvedValueOnce(source);

    const response = await layerFeaturesGET(
      new NextRequest("http://localhost/api/v1/layers/src_1/features?bbox=139,35,140,36"),
      { params: Promise.resolve({ id: "src_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      type: "FeatureCollection",
      features: [],
      metadata: {
        layerId: "src_1",
        sourceId: "src_1",
        standardizedFeatures: false,
        dataAvailability: "catalog_only",
        geometryStatus: "not_standardized",
        featureCount: 0,
        qualityStatus: "usable",
      },
    });
    expect(body.warnings[0]).toMatchObject({
      code: "not_standardized",
      severity: "info",
      sourceId: "src_1",
    });
  });

  it("rejects layer features requests for non-geospatial sources", async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const response = await layerFeaturesGET(
      new NextRequest("http://localhost/api/v1/layers/src_non_geo/features"),
      { params: Promise.resolve({ id: "src_non_geo" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "src_non_geo",
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it("rejects invalid layer bbox parameters", async () => {
    const response = await layerFeaturesGET(
      new NextRequest("http://localhost/api/v1/layers/src_1/features?bbox=invalid"),
      { params: Promise.resolve({ id: "src_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_query");
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("returns a nested v1 error envelope for rate limits", async () => {
    let response = await pointGET(new NextRequest("http://localhost/api/v1/records/point?lat=100&lng=139"));
    for (let index = 0; index < 120; index++) {
      response = await pointGET(new NextRequest("http://localhost/api/v1/records/point?lat=100&lng=139"));
    }
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatchObject({
      code: "rate_limited",
      message: expect.any(String),
      retryAfterSeconds: expect.any(Number),
    });
  });
});
