import { describe, expect, it } from "vitest";
import type { Neighborhood3x3 } from "@/lib/terrain/geo";
import { calculateSlopeDeg } from "@/lib/terrain/geo";

/** Fill all nine cells with the same elevation. */
function flat(z: number): Neighborhood3x3 {
  return { z1: z, z2: z, z3: z, z4: z, z5: z, z6: z, z7: z, z8: z, z9: z };
}

describe("calculateSlopeDeg", () => {
  it("returns 0 degrees for a flat neighborhood", () => {
    expect(calculateSlopeDeg(flat(100), 10, 10)).toBeCloseTo(0, 10);
  });

  it("computes a 45 degree slope for an east-facing 1:1 gradient", () => {
    // Columns rise west->east: 0, 10, 20 over 10 m spacing -> gradient 1.0.
    const neighborhood: Neighborhood3x3 = {
      z1: 0,
      z2: 10,
      z3: 20,
      z4: 0,
      z5: 10,
      z6: 20,
      z7: 0,
      z8: 10,
      z9: 20,
    };
    expect(calculateSlopeDeg(neighborhood, 10, 10)).toBeCloseTo(45, 6);
  });

  it("computes a 45 degree slope for a north-south 1:1 gradient", () => {
    // Rows rise top->bottom: 0, 10, 20 over 10 m spacing -> gradient 1.0.
    const neighborhood: Neighborhood3x3 = {
      z1: 0,
      z2: 0,
      z3: 0,
      z4: 10,
      z5: 10,
      z6: 10,
      z7: 20,
      z8: 20,
      z9: 20,
    };
    expect(calculateSlopeDeg(neighborhood, 10, 10)).toBeCloseTo(45, 6);
  });

  it("computes a gentle slope for a shallow east gradient", () => {
    // Columns 0, 1, 2 over 10 m -> gradient 0.1 -> atan(0.1) ~= 5.7106 deg.
    const neighborhood: Neighborhood3x3 = {
      z1: 0,
      z2: 1,
      z3: 2,
      z4: 0,
      z5: 1,
      z6: 2,
      z7: 0,
      z8: 1,
      z9: 2,
    };
    expect(calculateSlopeDeg(neighborhood, 10, 10)).toBeCloseTo(5.7106, 3);
  });

  it("returns null when the center cell is missing (no interpolation)", () => {
    const neighborhood: Neighborhood3x3 = { ...flat(100), z5: null };
    expect(calculateSlopeDeg(neighborhood, 10, 10)).toBeNull();
  });

  it("returns null when any edge or corner cell is missing", () => {
    expect(calculateSlopeDeg({ ...flat(100), z1: null }, 10, 10)).toBeNull();
    expect(calculateSlopeDeg({ ...flat(100), z6: null }, 10, 10)).toBeNull();
    expect(calculateSlopeDeg({ ...flat(100), z9: null }, 10, 10)).toBeNull();
  });
});
