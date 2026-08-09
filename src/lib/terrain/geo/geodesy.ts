/**
 * Small geodesy helpers for grid/section sampling (design spec 8.3).
 *
 * The analyses this system performs span at most a few kilometres, so the
 * spherical-earth approximations below are accurate to well under 1% — far
 * inside the uncertainty of the DEM itself. No external dependency, runs on
 * Workers / browsers / Node alike (repository policy).
 */

/** Mean earth radius (IUGG). */
const EARTH_RADIUS_M = 6371008.8;

/** Metres of ground distance per degree of latitude (nearly constant). */
export const METERS_PER_DEGREE_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

/** Metres of ground distance per degree of longitude at the given latitude. */
export function metersPerDegreeLon(latDeg: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/** Great-circle distance in metres between two lon/lat points (haversine). */
export function haversineDistanceM(
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
