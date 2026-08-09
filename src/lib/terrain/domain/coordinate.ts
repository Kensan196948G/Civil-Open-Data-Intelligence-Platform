/**
 * WGS84 (EPSG:4326) の緯度経度座標。
 */
export interface Coordinate {
  readonly lat: number;
  readonly lon: number;
}

const LAT_MIN = -90;
const LAT_MAX = 90;
const LON_MIN = -180;
const LON_MAX = 180;

export function isValidCoordinate(value: Coordinate): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lon) &&
    value.lat >= LAT_MIN &&
    value.lat <= LAT_MAX &&
    value.lon >= LON_MIN &&
    value.lon <= LON_MAX
  );
}
