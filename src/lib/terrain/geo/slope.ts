/**
 * Horn method slope calculation over a 3x3 neighborhood (design spec 8.3).
 *
 * Cell layout:
 *   z1 z2 z3
 *   z4 z5 z6
 *   z7 z8 z9
 */
export interface Neighborhood3x3 {
  readonly z1: number | null;
  readonly z2: number | null;
  readonly z3: number | null;
  readonly z4: number | null;
  readonly z5: number | null;
  readonly z6: number | null;
  readonly z7: number | null;
  readonly z8: number | null;
  readonly z9: number | null;
}

/**
 * Compute slope in degrees using the Horn 3x3 gradient.
 *
 * `dxMeters` / `dyMeters` are the real ground distances between adjacent cells;
 * the caller is responsible for supplying latitude-adjusted values.
 *
 * If any of the nine cells is missing (`null`) the center slope is undefined and
 * `null` is returned. No interpolation is performed (spec requirement).
 */
export function calculateSlopeDeg(
  neighborhood: Neighborhood3x3,
  dxMeters: number,
  dyMeters: number,
): number | null {
  const { z1, z2, z3, z4, z5, z6, z7, z8, z9 } = neighborhood;
  if (
    z1 === null ||
    z2 === null ||
    z3 === null ||
    z4 === null ||
    z5 === null ||
    z6 === null ||
    z7 === null ||
    z8 === null ||
    z9 === null
  ) {
    return null;
  }

  const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) / (8 * dxMeters);
  const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) / (8 * dyMeters);
  const rise = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
  return (Math.atan(rise) * 180) / Math.PI;
}
