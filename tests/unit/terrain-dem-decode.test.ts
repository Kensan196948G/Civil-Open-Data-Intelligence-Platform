import { describe, expect, it } from "vitest";
import { decodeElevation } from "@/lib/terrain/geo";

describe("decodeElevation", () => {
  it("decodes x = 0 as 0 m", () => {
    // R=0 G=0 B=0 -> x = 0
    expect(decodeElevation(0, 0, 0)).toBe(0);
  });

  it("decodes small positive values", () => {
    // R=0 G=0 B=100 -> x = 100 -> 1.00 m
    expect(decodeElevation(0, 0, 100)).toBeCloseTo(1.0, 10);
    // R=0 G=1 B=0 -> x = 256 -> 2.56 m
    expect(decodeElevation(0, 1, 0)).toBeCloseTo(2.56, 10);
  });

  it("decodes the maximum positive elevation at x = 2^23 - 1", () => {
    // R=127 G=255 B=255 -> x = 8388607 -> 83886.07 m
    expect(decodeElevation(127, 255, 255)).toBeCloseTo(83886.07, 2);
  });

  it("treats x = 2^23 as the invalid sentinel", () => {
    // R=128 G=0 B=0 -> x = 8388608 -> null
    expect(decodeElevation(128, 0, 0)).toBeNull();
  });

  it("decodes the deepest negative elevation just past the sentinel", () => {
    // R=128 G=0 B=1 -> x = 8388609 -> -83886.07 m
    const h = decodeElevation(128, 0, 1);
    expect(h).not.toBeNull();
    expect(h).toBeLessThan(0);
    expect(h).toBeCloseTo(-83886.07, 2);
  });

  it("decodes the shallowest negative elevation at x = 2^24 - 1", () => {
    // R=255 G=255 B=255 -> x = 16777215 -> -0.01 m
    const h = decodeElevation(255, 255, 255);
    expect(h).not.toBeNull();
    expect(h).toBeLessThan(0);
    expect(h).toBeCloseTo(-0.01, 10);
  });

  it("does not confuse a valid negative value with the invalid sentinel", () => {
    expect(decodeElevation(128, 0, 1)).not.toBeNull();
    expect(decodeElevation(255, 255, 255)).not.toBeNull();
  });
});
