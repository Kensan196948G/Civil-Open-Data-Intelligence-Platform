/**
 * GSI DEM PNG elevation decoding (design spec 8.2).
 *
 * The three 8-bit channels form a 24-bit value `x`:
 *   x = 2^16 * R + 2^8 * G + B
 *   x  < 2^23 -> h = x * 0.01 (m)
 *   x == 2^23 -> invalid (no elevation)
 *   x  > 2^23 -> h = (x - 2^24) * 0.01 (m)
 *
 * Negative elevations are valid values and must not be confused with the
 * invalid sentinel at x == 2^23.
 */

const POW_2_8 = 256;
const POW_2_16 = 65536;
const POW_2_23 = 8388608;
const POW_2_24 = 16777216;
const ELEVATION_RESOLUTION_M = 0.01;

/**
 * Decode elevation in meters from RGB channels (each 0-255).
 * Returns `null` for the invalid sentinel value.
 */
export function decodeElevation(r: number, g: number, b: number): number | null {
  const x = POW_2_16 * r + POW_2_8 * g + b;
  if (x === POW_2_23) return null;
  const signed = x < POW_2_23 ? x : x - POW_2_24;
  return signed * ELEVATION_RESOLUTION_M;
}
