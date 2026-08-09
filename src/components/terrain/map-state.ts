import type { BaseLayerId, LayerSelection, OverlayLayerId } from "./layers";
import { OVERLAY_LAYERS, isBaseLayerId, isOverlayLayerId } from "./layers";

/**
 * 地図の表示状態と URL ハッシュの相互変換 (共有URLの基礎)。
 * 形式: `#view=<zoom>/<lat>/<lon>&base=<id>&ov=<id>,<id>&point=<lat>,<lon>&tab=<id>`
 */

export interface MapViewState extends LayerSelection {
  readonly lat: number;
  readonly lon: number;
  readonly zoom: number;
}

export const DEFAULT_VIEW_STATE: MapViewState = {
  lat: 36.5,
  lon: 138.0,
  zoom: 5,
  base: "std",
  overlays: [],
};

const MIN_ZOOM = 2;
const MAX_ZOOM = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

export function serializeMapState(
  state: MapViewState,
  extras: { point?: { lat: number; lon: number } | null; tab?: string } = {},
): string {
  const view = `${roundZoom(state.zoom)}/${roundCoordinate(state.lat)}/${roundCoordinate(state.lon)}`;
  const parts = [`view=${view}`, `base=${state.base}`];
  if (state.overlays.length > 0) {
    const ordered = OVERLAY_LAYERS.map((layer) => layer.id).filter((id) =>
      state.overlays.includes(id),
    );
    parts.push(`ov=${ordered.join(",")}`);
  }
  if (extras.point !== undefined && extras.point !== null) {
    parts.push(`point=${roundCoordinate(extras.point.lat)},${roundCoordinate(extras.point.lon)}`);
  }
  if (extras.tab !== undefined) {
    parts.push(`tab=${extras.tab}`);
  }
  return parts.join("&");
}

export function parseMapState(hash: string): {
  view: MapViewState;
  point: { lat: number; lon: number } | null;
  tab: string | null;
} {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (trimmed === "") {
    return { view: DEFAULT_VIEW_STATE, point: null, tab: null };
  }

  const params = new URLSearchParams(trimmed);
  const view = parseViewParam(params.get("view"));
  const baseParam = params.get("base");
  const base: BaseLayerId =
    baseParam !== null && isBaseLayerId(baseParam) ? baseParam : DEFAULT_VIEW_STATE.base;
  const overlays = parseOverlaysParam(params.get("ov"));
  const point = parsePointParam(params.get("point"));
  const tab = params.get("tab");
  return { view: { ...view, base, overlays }, point, tab };
}

function parseViewParam(value: string | null): Pick<MapViewState, "lat" | "lon" | "zoom"> {
  const fallback = {
    lat: DEFAULT_VIEW_STATE.lat,
    lon: DEFAULT_VIEW_STATE.lon,
    zoom: DEFAULT_VIEW_STATE.zoom,
  };
  if (value === null) {
    return fallback;
  }
  const parts = value.split("/");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
    return fallback;
  }
  const zoom = Number(parts[0]);
  const lat = Number(parts[1]);
  const lon = Number(parts[2]);
  if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return fallback;
  }
  return {
    zoom: roundZoom(clamp(zoom, MIN_ZOOM, MAX_ZOOM)),
    lat: roundCoordinate(clamp(lat, -90, 90)),
    lon: roundCoordinate(clamp(lon, -180, 180)),
  };
}

function parseOverlaysParam(value: string | null): readonly OverlayLayerId[] {
  if (value === null || value === "") {
    return [];
  }
  const ids: OverlayLayerId[] = [];
  for (const raw of value.split(",")) {
    if (isOverlayLayerId(raw) && !ids.includes(raw)) {
      ids.push(raw);
    }
  }
  return ids;
}

function parsePointParam(value: string | null): { lat: number; lon: number } | null {
  if (value === null) return null;
  const [lat, lon] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}
