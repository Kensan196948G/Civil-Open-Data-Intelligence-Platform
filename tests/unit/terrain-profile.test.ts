import { describe, expect, it } from "vitest";
import { profileStatistics } from "@/lib/terrain/geo";
import { haversineDistanceM, metersPerDegreeLon, METERS_PER_DEGREE_LAT } from "@/lib/terrain/geo";

describe("profileStatistics", () => {
  it("computes gain / loss / slopes for a simple ramp", () => {
    const stats = profileStatistics([
      { distanceM: 0, elevationM: 100 },
      { distanceM: 100, elevationM: 110 },
      { distanceM: 200, elevationM: 105 },
    ]);

    expect(stats.totalLengthM).toBe(200);
    expect(stats.gainM).toBe(10);
    expect(stats.lossM).toBe(5);
    // 区間勾配: atan(10/100)=5.71°, atan(5/100)=2.86° → 距離加重平均 4.29°
    expect(stats.maxSlopeDeg).toBeCloseTo(5.71, 2);
    expect(stats.meanSlopeDeg).toBeCloseTo(4.29, 2);
    expect(stats.validSampleRatio).toBe(1);
    expect(stats.validSegmentLengthM).toBe(200);
  });

  it("skips segments across missing samples without interpolating", () => {
    const stats = profileStatistics([
      { distanceM: 0, elevationM: 100 },
      { distanceM: 100, elevationM: null },
      { distanceM: 200, elevationM: 300 },
    ]);

    // 欠損を跨ぐ2区間はどちらも評価されない — 100→300 の見かけの急登は作らない。
    expect(stats.gainM).toBe(0);
    expect(stats.maxSlopeDeg).toBeNull();
    expect(stats.meanSlopeDeg).toBeNull();
    expect(stats.validSampleRatio).toBeCloseTo(2 / 3, 5);
    expect(stats.validSegmentLengthM).toBe(0);
  });

  it("rejects fewer than 2 samples and non-increasing distances", () => {
    expect(() => profileStatistics([{ distanceM: 0, elevationM: 1 }])).toThrow(RangeError);
    expect(() =>
      profileStatistics([
        { distanceM: 0, elevationM: 1 },
        { distanceM: 0, elevationM: 2 },
      ]),
    ).toThrow(RangeError);
  });
});

describe("geodesy", () => {
  it("computes ~111km per degree of latitude", () => {
    expect(METERS_PER_DEGREE_LAT).toBeCloseTo(111195, -2);
    expect(haversineDistanceM({ lat: 35, lon: 138 }, { lat: 36, lon: 138 })).toBeCloseTo(
      METERS_PER_DEGREE_LAT,
      -2,
    );
  });

  it("shrinks longitude degrees with latitude", () => {
    expect(metersPerDegreeLon(0)).toBeCloseTo(METERS_PER_DEGREE_LAT, 5);
    expect(metersPerDegreeLon(60)).toBeCloseTo(METERS_PER_DEGREE_LAT / 2, 0);
  });
});
