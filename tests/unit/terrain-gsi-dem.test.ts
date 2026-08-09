import { describe, expect, it, vi } from "vitest";
import { encodePng, lonLatToTilePixel } from "@/lib/terrain/geo";
import type { FetchContext } from "@/lib/terrain/adapters";
import {
  DEFAULT_DEM_PRIORITY,
  GSI_DEM_SOURCES,
  UpstreamTileError,
  buildGsiDemTileUrl,
  lookupElevation,
  pointQualityFor,
} from "@/lib/terrain/adapters";
import type { TileFetchResult, TileFetcher } from "@/lib/terrain/adapters";

const CTX: FetchContext = { requestId: "req-test" };
const TOKYO = { lat: 35.681236, lon: 139.767125 };
const NOW = () => new Date("2026-07-17T00:00:00.000Z");

const NO_DATA_RGB: readonly [number, number, number] = [128, 0, 0];
// x = 1250 -> 12.50 m
const ELEVATION_12_5_RGB: readonly [number, number, number] = [0, 4, 226];

function tileOf(rgb: readonly [number, number, number]): (readonly [number, number, number])[][] {
  return Array.from({ length: 256 }, () => Array.from({ length: 256 }, () => rgb));
}

async function pngOf(rgb: readonly [number, number, number]): Promise<Uint8Array> {
  return encodePng(tileOf(rgb));
}

function fetcherFromRoutes(routes: Record<string, TileFetchResult | Error>): TileFetcher {
  return (url) => {
    const match = Object.entries(routes).find(([fragment]) => url.pathname.includes(fragment));
    if (match === undefined) {
      throw new Error(`unexpected fetch: ${url.toString()}`);
    }
    const result = match[1];
    if (result instanceof Error) {
      return Promise.reject(result);
    }
    return Promise.resolve(result);
  };
}

describe("buildGsiDemTileUrl", () => {
  it("builds the documented GSI URL for each source", () => {
    expect(buildGsiDemTileUrl("DEM5A", 29105, 12903).toString()).toBe(
      "https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/15/29105/12903.png",
    );
    expect(buildGsiDemTileUrl("DEM10B", 14552, 6451).toString()).toBe(
      "https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/14552/6451.png",
    );
    expect(buildGsiDemTileUrl("DEM1A", 1, 2).toString()).toBe(
      "https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/1/2.png",
    );
  });
});

describe("pointQualityFor", () => {
  it("grades by source precision and marks only that source in the mix", () => {
    expect(pointQualityFor("DEM5A")).toMatchObject({ grade: "A", coverage: "FULL" });
    expect(pointQualityFor("DEM10B").grade).toBe("D");
    expect(pointQualityFor("DEM5C").sourceMix).toEqual({
      DEM1A: 0,
      DEM5A: 0,
      DEM5B: 0,
      DEM5C: 1,
      DEM10B: 0,
    });
    expect(pointQualityFor("DEM5B").missingRatio).toBe(0);
  });
});

describe("lookupElevation", () => {
  it("returns the first source that holds a value, without probing the rest", async () => {
    const fetcher = vi.fn<TileFetcher>(async () => ({
      status: 200,
      bytes: await pngOf(ELEVATION_12_5_RGB),
    }));

    const result = await lookupElevation(TOKYO, CTX, { fetcher, now: NOW });

    expect(result.elevationM).toBe(12.5);
    expect(result.source).toBe("DEM5A");
    expect(result.coverage).toBe("FULL");
    expect(result.attempted).toEqual(["DEM5A"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("attaches complete provenance to a successful lookup (Evidence First)", async () => {
    const fetcher = vi.fn<TileFetcher>(async () => ({
      status: 200,
      bytes: await pngOf(ELEVATION_12_5_RGB),
    }));

    const { provenance } = await lookupElevation(TOKYO, CTX, { fetcher, now: NOW });

    expect(provenance).toHaveLength(1);
    expect(provenance[0]).toMatchObject({
      sourceId: "gsi_dem5a_png",
      sourceName: GSI_DEM_SOURCES.DEM5A.name,
      termsUrl: "https://maps.gsi.go.jp/development/ichiran.html",
      retrievedAt: "2026-07-17T00:00:00.000Z",
      resolutionM: 5,
      processed: true,
    });
    expect(provenance[0]?.sourceUrl).toContain("dem5a_png/15/");
  });

  it("falls through 404 and no-data pixels to the next source in priority order", async () => {
    const fetcher = fetcherFromRoutes({
      dem5a_png: { status: 404, bytes: null },
      dem5b_png: { status: 200, bytes: await pngOf(NO_DATA_RGB) },
      dem5c_png: { status: 200, bytes: await pngOf(ELEVATION_12_5_RGB) },
    });

    const result = await lookupElevation(TOKYO, CTX, { fetcher, now: NOW });

    expect(result.source).toBe("DEM5C");
    expect(result.elevationM).toBe(12.5);
    expect(result.attempted).toEqual(["DEM5A", "DEM5B", "DEM5C"]);
  });

  it("reads the pixel addressed by lonLatToTilePixel, not just any pixel", async () => {
    const spec = GSI_DEM_SOURCES.DEM5A;
    const { px, py } = lonLatToTilePixel(TOKYO.lon, TOKYO.lat, spec.zoom);
    const pixels = tileOf(NO_DATA_RGB);
    (pixels[py] as (readonly [number, number, number])[])[px] = ELEVATION_12_5_RGB;
    const bytes = await encodePng(pixels);
    const fetcher: TileFetcher = () => Promise.resolve({ status: 200, bytes });

    const result = await lookupElevation(TOKYO, CTX, {
      fetcher,
      priority: ["DEM5A"],
      now: NOW,
    });

    expect(result.elevationM).toBe(12.5);
  });

  it("reports coverage NONE when every source legitimately lacks data", async () => {
    const noData = await pngOf(NO_DATA_RGB);
    const fetcher = fetcherFromRoutes({
      dem5a_png: { status: 404, bytes: null },
      dem5b_png: { status: 404, bytes: null },
      dem5c_png: { status: 200, bytes: noData },
      dem_png: { status: 204, bytes: null },
    });

    const result = await lookupElevation(TOKYO, CTX, { fetcher, now: NOW });

    expect(result).toMatchObject({
      elevationM: null,
      source: null,
      coverage: "NONE",
      provenance: [],
    });
    expect(result.attempted).toEqual([...DEFAULT_DEM_PRIORITY]);
  });

  it("throws UpstreamTileError instead of claiming absence when a source failed", async () => {
    const fetcher = fetcherFromRoutes({
      dem5a_png: new Error("network down"),
      dem5b_png: { status: 404, bytes: null },
      dem5c_png: { status: 404, bytes: null },
      dem_png: { status: 404, bytes: null },
    });

    await expect(lookupElevation(TOKYO, CTX, { fetcher, now: NOW })).rejects.toThrow(
      UpstreamTileError,
    );
  });

  it("treats HTTP 5xx and corrupt tiles as failures, not as absence", async () => {
    const fetcher = fetcherFromRoutes({
      dem5a_png: { status: 503, bytes: null },
      dem5b_png: { status: 200, bytes: Uint8Array.from([1, 2, 3]) },
      dem5c_png: { status: 404, bytes: null },
      dem_png: { status: 404, bytes: null },
    });

    await expect(lookupElevation(TOKYO, CTX, { fetcher, now: NOW })).rejects.toThrow(
      /upstream returned HTTP 503.*tile decode failed/,
    );
  });

  it("stops walking sources once the request is aborted (client gone)", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<TileFetcher>(() => Promise.reject(new Error("The user aborted")));

    await expect(
      lookupElevation(
        TOKYO,
        { requestId: "req-test", signal: controller.signal },
        { fetcher, now: NOW },
      ),
    ).rejects.toThrow("aborted");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("still returns a value found after earlier sources failed", async () => {
    const fetcher = fetcherFromRoutes({
      dem5a_png: new Error("network down"),
      dem5b_png: { status: 200, bytes: await pngOf(ELEVATION_12_5_RGB) },
    });

    const result = await lookupElevation(TOKYO, CTX, { fetcher, now: NOW });

    expect(result.source).toBe("DEM5B");
    expect(result.elevationM).toBe(12.5);
  });
});
