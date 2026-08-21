import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 妥当な入力は検証を通過して DB 到達まで進む。ここで測りたいのは
// 「検証で 400 にされないこと」なので、DB 層だけを差し替えて
// 検証の判定だけを観測する（DB の挙動は本テストの対象外）。
vi.mock("@/lib/db", () => ({
  prisma: { dataSource: { findMany: vi.fn().mockResolvedValue([]) } },
}));
const findStandardRecordsForGeometry = vi.fn();
vi.mock("@/lib/standard-records", () => ({
  findStandardRecordsForGeometry: (...a: unknown[]) => findStandardRecordsForGeometry(...a),
}));

import { POST as geometryPOST } from "@/app/api/v1/assessments/geometry/route";

beforeEach(() => {
  findStandardRecordsForGeometry.mockReset();
  findStandardRecordsForGeometry.mockResolvedValue(null);
});

/**
 * 未認証 POST で到達できる空間評価の境界検査。
 *
 * 修正前は bufferM に上限が無く、standard-records.ts の `radiusM + bufferM` により
 * radiusM の 100km 制限を加算で突破できた。半径 10^15m の ST_DWithin は GIST
 * インデックスを無効化し、standard_records 全行への測地距離計算 + ORDER BY
 * ST_Distance + COUNT の二重全表走査になる。
 * bbox は範囲未検証で [-1e9,-1e9,1e9,1e9] が通り、polygon は typeof === "object"
 * だけの検査で {} や [] が ST_GeomFromGeoJSON へ到達していた。
 */

const post = (body: unknown) =>
  geometryPOST(
    new NextRequest("http://localhost/api/v1/assessments/geometry", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

const circle = (extra: Record<string, unknown>) => ({
  mode: "circle",
  center: { lat: 35.68, lng: 139.76 },
  radiusM: 1000,
  ...extra,
});

describe("bufferM の上限", () => {
  it("radiusM の上限を加算で突破する値を拒否する", async () => {
    const res = await post(circle({ bufferM: 1e15 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_body");
  });

  it("負値と上限超過を拒否する", async () => {
    expect((await post(circle({ bufferM: -1 }))).status).toBe(400);
    expect((await post(circle({ bufferM: 10_001 }))).status).toBe(400);
  });

  it("上限ちょうど・未指定は 200 で通る（過剰拒否をしない）", async () => {
    expect((await post(circle({ bufferM: 10_000 }))).status).toBe(200);
    expect((await post(circle({}))).status).toBe(200);
  });
});

describe("bbox の範囲検査", () => {
  it("地理座標として成立しない包絡矩形を拒否する", async () => {
    const res = await post({ mode: "bbox", bbox: [-1e9, -1e9, 1e9, 1e9] });
    expect(res.status).toBe(400);
  });

  it("min >= max を拒否する", async () => {
    expect((await post({ mode: "bbox", bbox: [140, 35, 139, 36] })).status).toBe(400);
    expect((await post({ mode: "bbox", bbox: [139, 36, 140, 35] })).status).toBe(400);
  });

  it("正しい bbox は 200 で通る", async () => {
    expect((await post({ mode: "bbox", bbox: [139.6, 35.6, 139.8, 35.8] })).status).toBe(200);
  });
});

describe("polygon の型・頂点数検査", () => {
  it("空オブジェクト・配列を拒否する（ST_GeomFromGeoJSON へ渡さない）", async () => {
    expect((await post({ mode: "polygon", polygon: {} })).status).toBe(400);
    expect((await post({ mode: "polygon", polygon: [] })).status).toBe(400);
  });

  it("type が Polygon / MultiPolygon 以外を拒否する", async () => {
    const res = await post({ mode: "polygon", polygon: { type: "Point", coordinates: [139.7, 35.6] } });
    expect(res.status).toBe(400);
  });

  it("リングが4点未満・座標が数値でないものを拒否する", async () => {
    expect(
      (await post({ mode: "polygon", polygon: { type: "Polygon", coordinates: [[[139, 35], [140, 35]]] } })).status,
    ).toBe(400);
    expect(
      (
        await post({
          mode: "polygon",
          polygon: { type: "Polygon", coordinates: [[["a", "b"], [140, 35], [140, 36], ["a", "b"]]] },
        })
      ).status,
    ).toBe(400);
  });

  it("頂点数の上限を超えるポリゴンを拒否する", async () => {
    const ring = Array.from({ length: 10_002 }, (_, i) => [139 + (i % 100) / 1000, 35 + (i % 100) / 1000]);
    ring.push([...ring[0]]); // 閉鎖条件を満たしたうえで頂点数上限に触れさせる
    const res = await post({ mode: "polygon", polygon: { type: "Polygon", coordinates: [ring] } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/頂点数/);
  });

  it("閉じていないリングを拒否する（RFC 7946 の LinearRing 条件）", async () => {
    const res = await post({
      mode: "polygon",
      // 4点あるが先頭と末尾が一致しない
      polygon: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.7, 35.7]]] },
    });
    expect(res.status).toBe(400);
    expect(findStandardRecordsForGeometry).not.toHaveBeenCalled();
  });

  it("position の3要素目が数値でないものを拒否する", async () => {
    const res = await post({
      mode: "polygon",
      polygon: {
        type: "Polygon",
        coordinates: [[[139.6, 35.6, "invalid"], [139.8, 35.6, 0], [139.8, 35.8, 0], [139.6, 35.6, "invalid"]]],
      },
    });
    expect(res.status).toBe(400);
    expect(findStandardRecordsForGeometry).not.toHaveBeenCalled();
  });

  it("空の coordinates を拒否する（Polygon / MultiPolygon とも）", async () => {
    expect((await post({ mode: "polygon", polygon: { type: "Polygon", coordinates: [] } })).status).toBe(400);
    expect((await post({ mode: "polygon", polygon: { type: "MultiPolygon", coordinates: [] } })).status).toBe(400);
    expect(findStandardRecordsForGeometry).not.toHaveBeenCalled();
  });

  it("正しい Polygon は 200 で通る", async () => {
    const res = await post({
      mode: "polygon",
      polygon: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.6]]] },
    });
    expect(res.status).toBe(200);
  });

  it("正しい MultiPolygon は 200 で通る", async () => {
    const res = await post({
      mode: "polygon",
      polygon: {
        type: "MultiPolygon",
        coordinates: [
          [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.6]]],
          [[[140.1, 36.1], [140.3, 36.1], [140.3, 36.3], [140.1, 36.1]]],
        ],
      },
    });
    expect(res.status).toBe(200);
  });

  it("標高付き position (3要素) は通す", async () => {
    const res = await post({
      mode: "polygon",
      polygon: {
        type: "Polygon",
        coordinates: [[[139.6, 35.6, 10], [139.8, 35.6, 12], [139.8, 35.8, 15], [139.6, 35.6, 10]]],
      },
    });
    expect(res.status).toBe(200);
  });
});
