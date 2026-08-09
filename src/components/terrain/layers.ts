import type { StyleSpecification } from "maplibre-gl";

/**
 * 国土地理院タイルのレイヤー定義 (統合元 Civil-Terrain-Slope-Risk-Viewer)。
 * 出典: 国土地理院 地理院タイル一覧 https://maps.gsi.go.jp/development/ichiran.html
 */

export type BaseLayerId = "std" | "pale" | "photo";
export type OverlayLayerId = "slope" | "hillshade";
export type MapLayerId = BaseLayerId | OverlayLayerId;

export interface TileLayerDefinition<Id extends MapLayerId = MapLayerId> {
  readonly id: Id;
  readonly label: string;
  readonly kind: "base" | "overlay";
  readonly tileUrlTemplate: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly attribution: string;
  readonly opacity: number;
}

const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';

export const BASE_LAYERS: readonly TileLayerDefinition<BaseLayerId>[] = [
  {
    id: "std",
    label: "標準地図",
    kind: "base",
    tileUrlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
    minZoom: 2,
    maxZoom: 18,
    attribution: GSI_ATTRIBUTION,
    opacity: 1,
  },
  {
    id: "pale",
    label: "淡色地図",
    kind: "base",
    tileUrlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
    minZoom: 2,
    maxZoom: 18,
    attribution: GSI_ATTRIBUTION,
    opacity: 1,
  },
  {
    id: "photo",
    label: "写真",
    kind: "base",
    tileUrlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    minZoom: 2,
    maxZoom: 18,
    attribution: GSI_ATTRIBUTION,
    opacity: 1,
  },
];

export const OVERLAY_LAYERS: readonly TileLayerDefinition<OverlayLayerId>[] = [
  {
    id: "slope",
    label: "傾斜量図",
    kind: "overlay",
    tileUrlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png",
    minZoom: 3,
    maxZoom: 15,
    attribution: GSI_ATTRIBUTION,
    opacity: 0.6,
  },
  {
    id: "hillshade",
    label: "陰影起伏図",
    kind: "overlay",
    tileUrlTemplate: "https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png",
    minZoom: 2,
    maxZoom: 16,
    attribution: GSI_ATTRIBUTION,
    opacity: 0.5,
  },
];

export const ALL_LAYERS: readonly TileLayerDefinition[] = [...BASE_LAYERS, ...OVERLAY_LAYERS];

export function isBaseLayerId(value: string): value is BaseLayerId {
  return BASE_LAYERS.some((layer) => layer.id === value);
}

export function isOverlayLayerId(value: string): value is OverlayLayerId {
  return OVERLAY_LAYERS.some((layer) => layer.id === value);
}

export interface LayerSelection {
  readonly base: BaseLayerId;
  readonly overlays: readonly OverlayLayerId[];
}

export function buildMapStyle(selection: LayerSelection): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const layers: StyleSpecification["layers"] = [];

  for (const layer of ALL_LAYERS) {
    sources[layer.id] = {
      type: "raster",
      tiles: [layer.tileUrlTemplate],
      tileSize: 256,
      minzoom: layer.minZoom,
      maxzoom: layer.maxZoom,
      attribution: layer.attribution,
    };
    layers.push({
      id: layer.id,
      type: "raster",
      source: layer.id,
      layout: {
        visibility: isLayerVisible(layer, selection) ? "visible" : "none",
      },
      paint: {
        "raster-opacity": layer.opacity,
      },
    });
  }

  return { version: 8, sources, layers };
}

function isLayerVisible(layer: TileLayerDefinition, selection: LayerSelection): boolean {
  if (layer.kind === "base") {
    return layer.id === selection.base;
  }
  return (selection.overlays as readonly string[]).includes(layer.id);
}

export interface LayerVisibilityTarget {
  setLayoutProperty(layerId: string, name: "visibility", value: "visible" | "none"): void;
}

export function applyLayerSelection(
  target: LayerVisibilityTarget,
  selection: LayerSelection,
): void {
  for (const layer of ALL_LAYERS) {
    target.setLayoutProperty(
      layer.id,
      "visibility",
      isLayerVisible(layer, selection) ? "visible" : "none",
    );
  }
}
