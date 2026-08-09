/**
 * Deterministic cache key for a single normalized source tile.
 *
 * Format: `v1:{sourceKey}:{sourceVersion}:{z}:{x}:{y}:{normalizerVersion}`
 *
 * Both the source version and the normalizer version are part of the key so a
 * bump on either side transparently invalidates previously cached entries.
 */
export interface CacheKeyParams {
  readonly sourceKey: string;
  readonly sourceVersion: string;
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly normalizerVersion: string;
}

const CACHE_KEY_SCHEMA_VERSION = "v1";

export function buildCacheKey(params: CacheKeyParams): string {
  return [
    CACHE_KEY_SCHEMA_VERSION,
    params.sourceKey,
    params.sourceVersion,
    params.z,
    params.x,
    params.y,
    params.normalizerVersion,
  ].join(":");
}
