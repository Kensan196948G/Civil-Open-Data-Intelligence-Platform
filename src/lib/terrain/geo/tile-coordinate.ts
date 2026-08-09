import type { Coordinate } from "../domain";

/**
 * XYZ / Web Mercator tile coordinate (design spec 8.1).
 */
export interface TileXY {
  readonly x: number;
  readonly y: number;
}

/** A tile index plus the pixel position inside that tile. */
export interface TilePixel {
  readonly tile: TileXY;
  /** Pixel column within the tile, 0..tileSize-1. */
  readonly px: number;
  /** Pixel row within the tile, 0..tileSize-1. */
  readonly py: number;
}

/**
 * Web Mercator valid latitude bound. Latitudes beyond this are clamped because
 * the projection diverges toward the poles.
 */
export const MAX_MERCATOR_LATITUDE = 85.05112878;

/** Zoom levels above 24 are not served by any tile source this system uses. */
const MAX_ZOOM = 24;

function clampLatitude(lat: number): number {
  if (lat > MAX_MERCATOR_LATITUDE) return MAX_MERCATOR_LATITUDE;
  if (lat < -MAX_MERCATOR_LATITUDE) return -MAX_MERCATOR_LATITUDE;
  return lat;
}

/**
 * A fractional zoom or a negative zoom silently produces nonsense tile URLs,
 * so invalid zooms fail loudly (issue #3).
 */
function assertValidZoom(zoom: number): void {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_ZOOM) {
    throw new RangeError(`zoom must be an integer in [0, ${MAX_ZOOM}], got ${zoom}`);
  }
}

/** Clamp a tile/pixel index into [0, upperExclusive - 1]. */
function clampIndex(value: number, upperExclusive: number): number {
  if (value < 0) return 0;
  if (value >= upperExclusive) return upperExclusive - 1;
  return value;
}

/** Continuous (unfloored) tile-space coordinates. */
function projectToTileSpace(lon: number, lat: number, zoom: number): { xf: number; yf: number } {
  const n = 2 ** zoom;
  const phi = (clampLatitude(lat) * Math.PI) / 180;
  const xf = ((lon + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) * n) / 2;
  return { xf, yf };
}

/**
 * Convert a lon/lat pair to an XYZ tile index at the given zoom level.
 *
 * Out-of-range latitudes are clamped to the Web Mercator bound before
 * projection, and the resulting indices are clamped into [0, 2^zoom - 1]:
 * lon=180 projects exactly onto the right edge (x = 2^zoom) and rounding at
 * the clamped latitude bound can land one step outside, both of which would
 * otherwise produce tile URLs that no server hosts (issue #3).
 */
export function lonLatToTileXY(lon: number, lat: number, zoom: number): TileXY {
  assertValidZoom(zoom);
  const n = 2 ** zoom;
  const { xf, yf } = projectToTileSpace(lon, lat, zoom);
  return {
    x: clampIndex(Math.floor(xf), n),
    y: clampIndex(Math.floor(yf), n),
  };
}

/**
 * Convert a lon/lat pair to a tile index plus the pixel position inside that
 * tile (used to read a single elevation out of a DEM tile, design spec 8.2).
 * The pixel is derived from the same clamped tile so the two never disagree.
 */
export function lonLatToTilePixel(
  lon: number,
  lat: number,
  zoom: number,
  tileSize: number = 256,
): TilePixel {
  if (!Number.isInteger(tileSize) || tileSize <= 0) {
    throw new RangeError(`tileSize must be a positive integer, got ${tileSize}`);
  }
  const tile = lonLatToTileXY(lon, lat, zoom);
  const { xf, yf } = projectToTileSpace(lon, lat, zoom);
  return {
    tile,
    px: clampIndex(Math.floor((xf - tile.x) * tileSize), tileSize),
    py: clampIndex(Math.floor((yf - tile.y) * tileSize), tileSize),
  };
}

/**
 * Convenience wrapper accepting the domain `Coordinate` type.
 */
export function coordinateToTileXY(coordinate: Coordinate, zoom: number): TileXY {
  return lonLatToTileXY(coordinate.lon, coordinate.lat, zoom);
}
