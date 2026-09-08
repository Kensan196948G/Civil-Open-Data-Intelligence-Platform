import { describe, expect, it } from "vitest";
import { sectionLineLengthM } from "@/components/terrain/section-line";

/**
 * 断面線の長さ判定の回帰テスト。
 *
 * 元の実装は JSX 内で次のように書かれていた。
 *
 *   sectionLine?.start !== null && sectionLine?.end !== null
 *
 * `sectionLine` が null のとき `sectionLine?.start` は **undefined** になり、
 * `undefined !== null` は true。したがって断面線が未指定でも「指定済み」の分岐へ
 * 入り、案内文「断面線は30m〜20kmで指定できます」は到達不能な死んだ分岐だった。
 * さらに表示は `formatMeters(0)` のハードコードで、常に「0 m」と出ていた。
 *
 * optional chaining と null 比較の組み合わせは目視で気づきにくいため、undefined と
 * null の双方をここで固定する。
 */
describe("sectionLineLengthM", () => {
  it("断面線が null なら長さは null（undefined !== null の罠に戻らない）", () => {
    expect(sectionLineLengthM(null)).toBeNull();
    expect(sectionLineLengthM(undefined)).toBeNull();
  });

  it("始点だけ・終点だけの途中状態では null", () => {
    expect(sectionLineLengthM({ start: { lat: 35.0, lon: 139.0 }, end: null })).toBeNull();
    expect(sectionLineLengthM({ start: null, end: { lat: 35.0, lon: 139.0 } })).toBeNull();
    expect(sectionLineLengthM({ start: null, end: null })).toBeNull();
  });

  it("両端が揃うと実際の距離を返す（0 固定ではない）", () => {
    // 緯度 35°付近で経度 0.01° ≒ 911m。
    const length = sectionLineLengthM({
      start: { lat: 35.0, lon: 139.0 },
      end: { lat: 35.0, lon: 139.01 },
    });

    expect(length).not.toBeNull();
    expect(length).toBeGreaterThan(800);
    expect(length).toBeLessThan(1000);
  });

  it("同一点なら 0 を返す（null と区別される）", () => {
    const length = sectionLineLengthM({
      start: { lat: 35.0, lon: 139.0 },
      end: { lat: 35.0, lon: 139.0 },
    });

    expect(length).toBe(0);
  });
});
