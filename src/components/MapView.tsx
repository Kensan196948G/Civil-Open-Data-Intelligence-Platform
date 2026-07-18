"use client";

import { useEffect, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  LayersControl,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { LatLng } from "leaflet";
import { geoJSON as leafletGeoJson, latLng } from "leaflet";
import type { GeoJsonObject } from "geojson";
import "leaflet/dist/leaflet.css";

type ElevationState = {
  latlng: LatLng;
  loading: boolean;
  elevation: number | null;
  hsrc: string | null;
  error?: string;
};

function isValidGeoJson(value: unknown): value is GeoJsonObject {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type?: unknown }).type;
  if (type === "FeatureCollection") {
    return Array.isArray((value as { features?: unknown }).features);
  }
  if (type === "Feature") {
    const feature = value as { geometry?: unknown; properties?: unknown };
    return feature.geometry === null || typeof feature.geometry === "object";
  }
  return ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(
    String(type),
  );
}

function ClickElevation({
  state,
  setState,
}: {
  state: ElevationState | null;
  setState: (s: ElevationState) => void;
}) {
  async function fetchElevation(target: LatLng) {
    setState({ latlng: target, loading: true, elevation: null, hsrc: null });
    try {
      const res = await fetch(
        `/api/map/elevation?lat=${target.lat.toFixed(6)}&lon=${target.lng.toFixed(6)}`,
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setState({
          latlng: target,
          loading: false,
          elevation: null,
          hsrc: null,
          error: data.message ?? "標高を取得できませんでした",
        });
        return;
      }
      setState({
        latlng: target,
        loading: false,
        elevation: data.elevation,
        hsrc: data.hsrc,
      });
    } catch {
      setState({
        latlng: target,
        loading: false,
        elevation: null,
        hsrc: null,
        error: "標高を取得できませんでした",
      });
    }
  }

  useMapEvents({
    async click(e) {
      await fetchElevation(e.latlng);
    },
  });

  if (!state) return null;
  return (
    <CircleMarker center={state.latlng} radius={8} pathOptions={{ color: "#2563eb" }}>
      <Popup>
        <div className="text-sm">
          <p>
            📍 {state.latlng.lat.toFixed(5)}, {state.latlng.lng.toFixed(5)}
          </p>
          {state.loading ? (
            <p>⏳ 標高取得中...</p>
          ) : state.error ? (
            <p>⚠️ {state.error}</p>
          ) : (
            <p>
              ⛰️ 標高: {state.elevation != null ? `${state.elevation} m` : "データなし(海域等)"}
              {state.hsrc && <span className="text-xs"> ({state.hsrc})</span>}
            </p>
          )}
        </div>
      </Popup>
    </CircleMarker>
  );
}

function FitGeoJsonBounds({ data, version }: { data: GeoJsonObject | null; version: number }) {
  const map = useMap();

  useEffect(() => {
    if (!data) return;
    const layer = leafletGeoJson(data);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.1), { maxZoom: 14 });
    }
  }, [data, map, version]);

  return null;
}

export default function MapView() {
  const [elevation, setElevation] = useState<ElevationState | null>(null);
  const [latInput, setLatInput] = useState("35.681236");
  const [lonInput, setLonInput] = useState("139.767125");
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [geoJsonText, setGeoJsonText] = useState("");
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonObject | null>(null);
  const [geoJsonKey, setGeoJsonKey] = useState(0);
  const [geoJsonError, setGeoJsonError] = useState<string | null>(null);

  function applyGeoJson() {
    setGeoJsonError(null);
    if (!geoJsonText.trim()) {
      setGeoJsonData(null);
      return;
    }
    try {
      const parsed = JSON.parse(geoJsonText);
      if (!isValidGeoJson(parsed)) {
        setGeoJsonError("GeoJSON として解釈できません (Feature / FeatureCollection / Geometry を確認してください)");
        return;
      }
      setGeoJsonData(parsed);
      setGeoJsonKey((k) => k + 1);
    } catch {
      setGeoJsonError("JSON の構文が正しくありません");
    }
  }

  async function fetchElevationForInputs() {
    setCoordinateError(null);
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setCoordinateError("緯度は -90〜90、経度は -180〜180 の数値で入力してください");
      return;
    }

    const target = latLng(lat, lon);
    setElevation({ latlng: target, loading: true, elevation: null, hsrc: null });
    try {
      const res = await fetch(`/api/map/elevation?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setElevation({
          latlng: target,
          loading: false,
          elevation: null,
          hsrc: null,
          error: data.message ?? "標高を取得できませんでした",
        });
        return;
      }
      setElevation({
        latlng: target,
        loading: false,
        elevation: data.elevation,
        hsrc: data.hsrc,
      });
    } catch {
      setElevation({
        latlng: target,
        loading: false,
        elevation: null,
        hsrc: null,
        error: "標高を取得できませんでした",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">📍 標高確認</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <div>
            <label htmlFor="map-latitude" className="mb-1 block text-xs font-medium text-slate-600">
              緯度
            </label>
            <input
              id="map-latitude"
              type="number"
              step="0.000001"
              min="-90"
              max="90"
              value={latInput}
              onChange={(event) => setLatInput(event.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            />
          </div>
          <div>
            <label htmlFor="map-longitude" className="mb-1 block text-xs font-medium text-slate-600">
              経度
            </label>
            <input
              id="map-longitude"
              type="number"
              step="0.000001"
              min="-180"
              max="180"
              value={lonInput}
              onChange={(event) => setLonInput(event.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            />
          </div>
          <button
            type="button"
            onClick={fetchElevationForInputs}
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          >
            ⛰️ 標高取得
          </button>
        </div>
        {coordinateError && (
          <p className="mt-2 rounded bg-red-50 px-2 py-1 text-sm text-red-700" role="alert">
            ⚠️ {coordinateError}
          </p>
        )}
        {elevation && (
          <p className="mt-2 text-xs text-slate-600" role="status">
            選択地点: {elevation.latlng.lat.toFixed(5)}, {elevation.latlng.lng.toFixed(5)}
            {elevation.loading
              ? " / 標高取得中"
              : elevation.error
                ? ` / ${elevation.error}`
                : ` / 標高: ${elevation.elevation != null ? `${elevation.elevation} m` : "データなし"}`}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
        <MapContainer
          center={[36.104, 140.085]}
          zoom={5}
          scrollWheelZoom
          style={{ height: "60vh", width: "100%" }}
        >
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="🗺️ 標準地図">
              <TileLayer
                attribution='&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
                url="https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"
                maxZoom={18}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="🌫️ 淡色地図">
              <TileLayer
                attribution='&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
                url="https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"
                maxZoom={18}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="📷 空中写真">
              <TileLayer
                attribution='&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
                url="https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"
                maxZoom={18}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="⛰️ 陰影起伏図">
              <TileLayer
                attribution='&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
                url="https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png"
                maxZoom={16}
              />
            </LayersControl.BaseLayer>
          </LayersControl>
          <ClickElevation state={elevation} setState={setElevation} />
          <FitGeoJsonBounds data={geoJsonData} version={geoJsonKey} />
          {geoJsonData && (
            <GeoJSON
              key={geoJsonKey}
              data={geoJsonData}
              style={{ color: "#dc2626", weight: 2 }}
            />
          )}
        </MapContainer>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">📐 GeoJSON オーバーレイ</h2>
        <p id="geojson-overlay-description" className="mb-2 text-xs text-slate-500">
          GeoJSON (FeatureCollection 等) を貼り付けると地図上に表示します。データはブラウザ内でのみ処理され、サーバへ送信されません。
        </p>
        <label htmlFor="geojson-overlay" className="mb-1 block text-xs font-medium text-slate-600">
          GeoJSONデータ
        </label>
        <textarea
          id="geojson-overlay"
          value={geoJsonText}
          onChange={(e) => setGeoJsonText(e.target.value)}
          rows={5}
          placeholder='{"type":"FeatureCollection","features":[...]}'
          aria-describedby="geojson-overlay-description"
          className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={applyGeoJson}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            🗺️ 地図に表示
          </button>
          <button
            type="button"
            onClick={() => {
              setGeoJsonText("");
              setGeoJsonData(null);
              setGeoJsonError(null);
            }}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            クリア
          </button>
          {geoJsonError && <p className="text-sm text-red-600" role="alert">⚠️ {geoJsonError}</p>}
        </div>
      </div>
    </div>
  );
}
