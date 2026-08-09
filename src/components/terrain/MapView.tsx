"use client";

import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, GeoJSONSourceSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { applyLayerSelection, buildMapStyle } from "./layers";
import type { MapViewState } from "./map-state";

export interface MapFocusRequest {
  readonly coordinate: { readonly lat: number; readonly lon: number };
  readonly zoom: number;
  readonly token: number;
}

export interface SectionLineState {
  readonly start: { readonly lat: number; readonly lon: number } | null;
  readonly end: { readonly lat: number; readonly lon: number } | null;
}

export interface MapViewProps {
  readonly view: MapViewState;
  readonly onViewChange: (view: MapViewState) => void;
  readonly onMapClick?: (coordinate: { lat: number; lon: number }) => void;
  readonly selectedPoint?: { readonly lat: number; readonly lon: number } | null;
  readonly sectionLine?: SectionLineState | null;
  readonly focus?: MapFocusRequest | null;
}

const SELECTED_POINT_SOURCE = "selected-point";
const SELECTED_POINT_LAYER = "selected-point-circle";
const SECTION_SOURCE = "section-line";
const SECTION_STROKE_LAYER = "section-line-stroke";
const SECTION_POINT_LAYER = "section-line-points";

type GeoJsonData = GeoJSONSourceSpecification["data"];
type FeatureCollectionData = Extract<GeoJsonData, { type: "FeatureCollection" }>;
type FeatureItem = FeatureCollectionData["features"][number];
type LayerSpec = Parameters<maplibregl.Map["addLayer"]>[0];

const EMPTY_COLLECTION: GeoJsonData = { type: "FeatureCollection", features: [] };

function upsertGeoJson(
  map: maplibregl.Map,
  sourceId: string,
  data: GeoJsonData,
  layers: readonly LayerSpec[],
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (source !== undefined) {
    source.setData(data);
    return;
  }
  if (data === EMPTY_COLLECTION) {
    return;
  }
  map.addSource(sourceId, { type: "geojson", data });
  for (const layer of layers) {
    map.addLayer(layer);
  }
}

function selectedPointData(
  coordinate: { readonly lat: number; readonly lon: number } | null,
): GeoJsonData {
  if (coordinate === null) {
    return EMPTY_COLLECTION;
  }
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [coordinate.lon, coordinate.lat] },
    properties: {},
  };
}

function applySelectedPoint(
  map: maplibregl.Map,
  coordinate: { readonly lat: number; readonly lon: number } | null,
): void {
  upsertGeoJson(map, SELECTED_POINT_SOURCE, selectedPointData(coordinate), [
    {
      id: SELECTED_POINT_LAYER,
      type: "circle",
      source: SELECTED_POINT_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": "#d6443b",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
  ]);
}

function sectionLineData(line: SectionLineState | null): GeoJsonData {
  if (line === null || (line.start === null && line.end === null)) {
    return EMPTY_COLLECTION;
  }
  const features: FeatureItem[] = [];
  for (const point of [line.start, line.end]) {
    if (point !== null) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        properties: {},
      });
    }
  }
  if (line.start !== null && line.end !== null) {
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [line.start.lon, line.start.lat],
          [line.end.lon, line.end.lat],
        ],
      },
      properties: {},
    });
  }
  return { type: "FeatureCollection", features };
}

function applySectionLine(map: maplibregl.Map, line: SectionLineState | null): void {
  upsertGeoJson(map, SECTION_SOURCE, sectionLineData(line), [
    {
      id: SECTION_STROKE_LAYER,
      type: "line",
      source: SECTION_SOURCE,
      filter: ["==", "$type", "LineString"],
      paint: { "line-color": "#e08a2b", "line-width": 3 },
    },
    {
      id: SECTION_POINT_LAYER,
      type: "circle",
      source: SECTION_SOURCE,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": 6,
        "circle-color": "#e08a2b",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
  ]);
}

export function TerrainMapView({
  view,
  onViewChange,
  onMapClick,
  selectedPoint,
  sectionLine,
  focus,
}: MapViewProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const viewRef = useRef(view);
  const onViewChangeRef = useRef(onViewChange);
  const onMapClickRef = useRef(onMapClick);

  viewRef.current = view;
  onViewChangeRef.current = onViewChange;
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const initial = viewRef.current;
    const map = new maplibregl.Map({
      container,
      style: buildMapStyle(initial),
      center: [initial.lon, initial.lat],
      zoom: initial.zoom,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: false }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.on("moveend", () => {
      const center = map.getCenter();
      onViewChangeRef.current({
        ...viewRef.current,
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
      });
    });
    map.on("click", (event) => {
      onMapClickRef.current?.({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    mapRef.current = map;
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    const apply = (): void => {
      applyLayerSelection(map, viewRef.current);
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [view.base, view.overlays]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    const apply = (): void => {
      applySelectedPoint(map, selectedPoint ?? null);
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [selectedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    const apply = (): void => {
      applySectionLine(map, sectionLine ?? null);
    };
    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [sectionLine]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || focus == null) {
      return;
    }
    map.flyTo({
      center: [focus.coordinate.lon, focus.coordinate.lat],
      zoom: focus.zoom,
      duration: 800,
    });
  }, [focus]);

  return (
    <div
      ref={containerRef}
      className="h-[480px] w-full"
      data-testid="terrain-map-view"
      role="region"
      aria-label="地形地図"
    />
  );
}
