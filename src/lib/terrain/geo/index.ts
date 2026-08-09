export type { TileXY, TilePixel } from "./tile-coordinate";
export {
  MAX_MERCATOR_LATITUDE,
  lonLatToTileXY,
  lonLatToTilePixel,
  coordinateToTileXY,
} from "./tile-coordinate";

export { decodeElevation } from "./dem-decode";

export type { DecodedPng } from "./png-codec";
export { decodePng, encodePng, rgbAt } from "./png-codec";

export type { Neighborhood3x3 } from "./slope";
export { calculateSlopeDeg } from "./slope";

export { METERS_PER_DEGREE_LAT, metersPerDegreeLon, haversineDistanceM } from "./geodesy";

export type {
  ElevationGrid,
  SlopeStatistics,
  TerrainClass,
  TerrainClassification,
  TerrainClassificationOptions,
} from "./grid-analysis";
export {
  DEFAULT_STEEP_SLOPE_THRESHOLD_DEG,
  computeSlopeGrid,
  slopeStatistics,
  classifyTerrain,
} from "./grid-analysis";

export type { ProfileSample, ProfileStatistics } from "./profile";
export { profileStatistics } from "./profile";
