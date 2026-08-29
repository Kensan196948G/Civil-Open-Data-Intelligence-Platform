import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { GET as weatherGET } from "@/app/api/v1/observations/weather/route";
import { GET as marineGET } from "@/app/api/v1/observations/marine/route";
import { GET as terrainRunsGET } from "@/app/api/v1/terrain/runs/route";

/**
 * ルート層の結線検査。
 *
 * ヘルパ単体が正しくても、ルートから呼ばれていなければ意味がない。
 * ここでは「不正なクエリで 400 が返る」ことを、DB へ到達する前の分岐として測る。
 * 修正前はいずれも take: NaN / lte: Invalid Date が Prisma へ渡り、
 * 未認証の GET だけで未捕捉の 500 を誘発できた。
 */

const url = (base: string, qs: string) => new NextRequest(`http://localhost${base}?${qs}`);

describe("GET /api/v1/observations/weather のクエリ検証", () => {
  it("limit が数値でなければ 400（NaN を Prisma へ渡さない）", async () => {
    const res = await weatherGET(url("/api/v1/observations/weather", "siteId=SITE01&limit=abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_query");
  });

  it("limit が範囲外なら 400", async () => {
    for (const limit of ["0", "-1", "2001", "1.5"]) {
      const res = await weatherGET(url("/api/v1/observations/weather", `siteId=SITE01&limit=${limit}`));
      expect(res.status, `limit=${limit}`).toBe(400);
    }
  });

  it("t0 / t1 が解釈できなければ 400（Invalid Date を Prisma へ渡さない）", async () => {
    const t1 = await weatherGET(url("/api/v1/observations/weather", "siteId=SITE01&t1=notadate"));
    expect(t1.status).toBe(400);
    const t0 = await weatherGET(url("/api/v1/observations/weather", "siteId=SITE01&t0=notadate"));
    expect(t0.status).toBe(400);
  });

  it("t0 が t1 より後なら 400（黙って空配列を返さない）", async () => {
    const res = await weatherGET(
      url("/api/v1/observations/weather", "siteId=SITE01&t0=2026-08-02T00:00:00Z&t1=2026-08-01T00:00:00Z"),
    );
    expect(res.status).toBe(400);
  });

  it("siteId 未指定は従来どおり 400", async () => {
    const res = await weatherGET(url("/api/v1/observations/weather", ""));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/observations/marine のクエリ検証", () => {
  it("limit が数値でなければ 400", async () => {
    const res = await marineGET(url("/api/v1/observations/marine", "siteId=SITE01&limit=abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_query");
  });

  it("t1 が解釈できなければ 400", async () => {
    const res = await marineGET(url("/api/v1/observations/marine", "siteId=SITE01&t1=notadate"));
    expect(res.status).toBe(400);
  });

  it("t0 が t1 より後なら 400", async () => {
    const res = await marineGET(
      url("/api/v1/observations/marine", "siteId=SITE01&t0=2026-08-02T00:00:00Z&t1=2026-08-01T00:00:00Z"),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/terrain/runs のクエリ検証", () => {
  it("limit が数値でなければ 400", async () => {
    const res = await terrainRunsGET(url("/api/v1/terrain/runs", "limit=abc"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_query");
  });

  it("limit が範囲外なら 400", async () => {
    const res = await terrainRunsGET(url("/api/v1/terrain/runs", "limit=201"));
    expect(res.status).toBe(400);
  });
});
