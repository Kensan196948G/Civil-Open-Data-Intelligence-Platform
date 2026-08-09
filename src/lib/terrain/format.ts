/** 解析結果表示用の書式ヘルパー。null は「—」(値の捏造をしない)。 */

export function formatDeg(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}°`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function formatMeters(value: number | null): string {
  if (value === null) {
    return "—";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} km`;
  }
  return `${value.toFixed(0)} m`;
}

export function formatCoordinate(coordinate: {
  readonly lat: number;
  readonly lon: number;
}): string {
  return `緯度 ${coordinate.lat.toFixed(5)} / 経度 ${coordinate.lon.toFixed(5)}`;
}
