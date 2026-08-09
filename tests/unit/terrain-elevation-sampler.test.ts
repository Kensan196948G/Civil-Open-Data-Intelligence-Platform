// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encodePng } from "@/lib/terrain/geo";
import { DemTileStore, sampleElevation, summarizeSamples, worstGradeOf } from "@/lib/terrain/elevation-sampler";
import { elevationToRgb, fakeTileFetch, pngResponse, uniformDemTile } from "@/lib/terrain/test-tiles";

const COORD = { lat: 35.36, lon: 138.72 };

describe("sampleElevation", () => {
  it("resolves the elevation from the highest-priority source", async () => {
    const tile = await uniformDemTile(123.45);
    const store = new DemTileStore(
      fakeTileFetch((url) => (url.includes("dem5a_png") ? pngResponse(tile) : null)),
    );

    const outcome = await sampleElevation(store, COORD);

    expect(outcome.elevationM).toBeCloseTo(123.45, 2);
    expect(outcome.source).toBe("DEM5A");
    expect(outcome.failed).toBe(false);
  });

  it("falls back to DEM10B when finer sources have no tile (404)", async () => {
    const tile = await uniformDemTile(200);
    const store = new DemTileStore(
      fakeTileFetch((url) => (url.includes("dem_png") ? pngResponse(tile) : null)),
    );

    const outcome = await sampleElevation(store, COORD);

    expect(outcome.elevationM).toBeCloseTo(200, 2);
    expect(outcome.source).toBe("DEM10B");
  });

  it("reports failed (not absent) when a fetch errors and no value was found", async () => {
    const store = new DemTileStore(
      fakeTileFetch(() => {
        throw new Error("network down");
      }),
    );

    const outcome = await sampleElevation(store, COORD);

    expect(outcome.elevationM).toBeNull();
    expect(outcome.failed).toBe(true); // 不在を断定できない (Unknown is not Safe)
  });

  it("calls fetch without rebinding `this` (regression: browser 'Illegal invocation')", async () => {
    // window.fetch は this が window/globalThis 以外だと TypeError を投げる。
    // その挙動を再現したスタブで、プロパティ経由呼び出しの退行を検出する。
    const tile = await uniformDemTile(80);
    function strictFetch(
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      void input;
      void init;
      return Promise.resolve(pngResponse(tile));
    }
    const store = new DemTileStore(strictFetch as typeof fetch);

    const outcome = await sampleElevation(store, COORD);

    expect(outcome.failed).toBe(false);
    expect(outcome.elevationM).toBeCloseTo(80, 2);
  });

  it("passes an abort signal so hung fetches eventually time out", async () => {
    let receivedInit: RequestInit | undefined;
    const store = new DemTileStore(((_: RequestInfo | URL, init?: RequestInit) => {
      receivedInit = init;
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as typeof fetch);

    await sampleElevation(store, COORD);

    expect(receivedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a tile with unexpected dimensions as failed instead of crashing", async () => {
    // 実 GSI タイルは 256x256。寸法契約に違反する応答 (例: 縮小 PNG) では
    // 画素参照が範囲外になるが、解析全体を例外で落とさず「不在を断定でき
    // ない (failed)」として扱う (Issue #33 の E2E 初回失敗の regression)。
    const rgb = elevationToRgb(50);
    const tiny = await encodePng([
      [rgb, rgb],
      [rgb, rgb],
    ]);
    const store = new DemTileStore(
      fakeTileFetch((url) => (url.includes("dem5a_png") ? pngResponse(tiny) : null)),
    );

    const outcome = await sampleElevation(store, COORD);

    expect(outcome.elevationM).toBeNull();
    expect(outcome.failed).toBe(true);
  });

  it("caches tiles so repeated samples do not refetch", async () => {
    const tile = await uniformDemTile(50);
    let fetchCount = 0;
    const store = new DemTileStore(
      fakeTileFetch((url) => {
        if (url.includes("dem5a_png")) {
          fetchCount++;
          return pngResponse(tile);
        }
        return null;
      }),
    );

    await sampleElevation(store, COORD);
    await sampleElevation(store, { lat: COORD.lat + 0.00001, lon: COORD.lon });

    expect(fetchCount).toBe(1);
  });
});

describe("summarizeSamples / worstGradeOf", () => {
  it("aggregates valid / absent / failed and the source mix", () => {
    const summary = summarizeSamples([
      { elevationM: 10, source: "DEM5A", failed: false },
      { elevationM: 20, source: "DEM10B", failed: false },
      { elevationM: null, source: null, failed: false },
      { elevationM: null, source: null, failed: true },
    ]);

    expect(summary).toMatchObject({ total: 4, valid: 2, absent: 1, failed: 1 });
    expect(summary.sourceMix.DEM5A).toBe(1);
    expect(summary.sourceMix.DEM10B).toBe(1);
    expect(summary.usedSources).toEqual(["DEM5A", "DEM10B"]);
  });

  it("returns the most conservative grade of the used sources", () => {
    expect(worstGradeOf(["DEM5A"])).toBe("A");
    expect(worstGradeOf(["DEM5A", "DEM10B"])).toBe("D");
    expect(worstGradeOf([])).toBe("UNKNOWN");
  });
});
