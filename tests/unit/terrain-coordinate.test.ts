import { describe, expect, it } from "vitest";
import { isValidCoordinate } from "@/lib/terrain/domain";

describe("isValidCoordinate", () => {
  it("accepts a coordinate within the valid range", () => {
    expect(isValidCoordinate({ lat: 35.681236, lon: 139.767125 })).toBe(true);
  });

  it("accepts boundary values", () => {
    expect(isValidCoordinate({ lat: 90, lon: 180 })).toBe(true);
    expect(isValidCoordinate({ lat: -90, lon: -180 })).toBe(true);
  });

  it("rejects out-of-range latitude", () => {
    expect(isValidCoordinate({ lat: 90.1, lon: 0 })).toBe(false);
  });

  it("rejects out-of-range longitude", () => {
    expect(isValidCoordinate({ lat: 0, lon: -180.1 })).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidCoordinate({ lat: NaN, lon: 0 })).toBe(false);
    expect(isValidCoordinate({ lat: 0, lon: Infinity })).toBe(false);
  });
});
