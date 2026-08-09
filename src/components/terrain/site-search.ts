export interface Landmark {
  readonly name: string;
  readonly pref: string;
  readonly lat: number;
  readonly lon: number;
}

export const LANDMARKS: readonly Landmark[] = [
  { name: "富士山 山頂付近", pref: "静岡県・山梨県", lat: 35.3606, lon: 138.7274 },
  { name: "富士吉田市 付近", pref: "山梨県", lat: 35.487, lon: 138.7972 },
  { name: "東京都庁 付近", pref: "東京都", lat: 35.6895, lon: 139.6917 },
  { name: "大阪城 付近", pref: "大阪府", lat: 34.6873, lon: 135.5262 },
  { name: "札幌市中心部 付近", pref: "北海道", lat: 43.0621, lon: 141.3544 },
  { name: "那覇市中心部 付近", pref: "沖縄県", lat: 26.2124, lon: 127.6809 },
  { name: "木曽駒ヶ岳 付近", pref: "長野県", lat: 35.7897, lon: 137.8067 },
  { name: "阿蘇山 付近", pref: "熊本県", lat: 32.8843, lon: 131.1044 },
  { name: "立山 付近", pref: "富山県", lat: 36.5758, lon: 137.6197 },
];

export type SearchResolution =
  | { readonly kind: "empty" }
  | { readonly kind: "coordinate"; readonly coordinate: { lat: number; lon: number } }
  | { readonly kind: "place"; readonly coordinate: { lat: number; lon: number }; readonly landmark: Landmark }
  | { readonly kind: "not-found" };

const COORD_PATTERN = /^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/;

export function parseSearchQuery(
  raw: string,
  landmarks: readonly Landmark[] = LANDMARKS,
): SearchResolution {
  const query = raw.trim();
  if (query === "") {
    return { kind: "empty" };
  }

  const match = COORD_PATTERN.exec(query);
  if (match !== null) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { kind: "coordinate", coordinate: { lat, lon } };
    }
    return { kind: "not-found" };
  }

  const hit = landmarks.find((place) => place.name.includes(query) || place.pref.includes(query));
  if (hit !== undefined) {
    return { kind: "place", coordinate: { lat: hit.lat, lon: hit.lon }, landmark: hit };
  }

  return { kind: "not-found" };
}
