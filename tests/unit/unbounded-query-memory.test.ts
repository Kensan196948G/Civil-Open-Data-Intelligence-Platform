import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * 未認証で到達できる集計系ルートのメモリ有界化に対する回帰テスト。
 *
 * Cloudflare Workers の 128MB 制限に対し、これらのルートは take も期間フィルタも
 * 持たずに findMany していた。数並列で叩かれると OOM でサービスが停止する。
 */

const findMany = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    marineObservation: { findMany: (...a: unknown[]) => findMany(...a) },
    weatherObservation: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}));

import { GET as wave50GET } from "@/app/api/v1/analysis/wave50/route";

beforeEach(() => {
  findMany.mockReset();
  findUnique.mockReset();
});

const get = (qs: string) => new NextRequest(`http://localhost/api/v1/analysis/wave50?${qs}`);

function observation(year: number, waveHM: number) {
  return { observedAt: new Date(Date.UTC(year, 0, 1)), sigWaveHM: waveHM };
}

describe("wave50 のクエリ有界化", () => {
  it("take と select を付けて発行する（全列・全件ロードをしない）", async () => {
    findMany.mockResolvedValue([observation(2020, 1.2), observation(2021, 2.4)]);
    await wave50GET(get("siteId=SITE01"));

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.take).toBeGreaterThan(0);
    // 使う列は観測日時と波高だけ
    expect(args.select).toEqual({ observedAt: true, sigWaveHM: true });
    // 期間フィルタが where に載る
    expect(args.where.observedAt).toBeDefined();
  });

  it("上限を超えたら黙って切り捨てず 422 で知らせる", async () => {
    // 上限+1 件返ってきた状況を再現する
    const args: { take?: number } = {};
    findMany.mockImplementation((a: { take: number }) => {
      args.take = a.take;
      return Promise.resolve(Array.from({ length: a.take }, (_, i) => observation(2000 + (i % 20), 1 + (i % 5))));
    });
    const res = await wave50GET(get("siteId=SITE01"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("range_too_large");
  });

  it("from / to が解釈できなければ 400", async () => {
    findMany.mockResolvedValue([]);
    expect((await wave50GET(get("siteId=SITE01&from=notadate"))).status).toBe(400);
    expect((await wave50GET(get("siteId=SITE01&to=notadate"))).status).toBe(400);
  });

  it("from > to は 400", async () => {
    findMany.mockResolvedValue([]);
    const res = await wave50GET(get("siteId=SITE01&from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z"));
    expect(res.status).toBe(400);
  });

  it("siteId 未指定は従来どおり 400", async () => {
    const res = await wave50GET(get(""));
    expect(res.status).toBe(400);
  });

  it("期間を指定すると where へ反映される", async () => {
    findMany.mockResolvedValue([observation(2020, 1.2), observation(2021, 2.4)]);
    await wave50GET(get("siteId=SITE01&from=2020-01-01T00:00:00Z&to=2021-12-31T00:00:00Z"));
    const where = findMany.mock.calls[0][0].where;
    expect(where.observedAt.gte.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(where.observedAt.lte.toISOString()).toBe("2021-12-31T00:00:00.000Z");
  });
});
