"use client";

import { useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  LayersControl,
  MapContainer,
  Popup,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import type { LatLng } from "leaflet";
import type { GeoJsonObject } from "geojson";
import "leaflet/dist/leaflet.css";

type ElevationState = {
  latlng: LatLng;
  loading: boolean;
  elevation: number | null;
  hsrc: string | null;
  error?: string;
};

function ClickElevation({
  state,
  setState,
}: {
  state: ElevationState | null;
  setState: (s: ElevationState) => void;
}) {
  useMapEvents({
    async click(e) {
      setState({ latlng: e.latlng, loading: true, elevation: null, hsrc: null });
      try {
        const res = await fetch(
          `/api/map/elevation?lat=${e.latlng.lat.toFixed(6)}&lon=${e.latlng.lng.toFixed(6)}`,
        );
        const data = await res.json();
        if (!res.ok || !data.success) {
          setState({
            latlng: e.latlng,
            loading: false,
            elevation: null,
            hsrc: null,
            error: data.message ?? "標高を取得できませんでした",
          });
          return;
        }
        setState({
          latlng: e.latlng,
          loading: false,
          elevation: data.elevation,
          hsrc: data.hsrc,
        });
      } catch {
        setState({
          latlng: e.latlng,
          loading: false,
          elevation: null,
          hsrc: null,
          error: "標高を取得できませんでした",
        });
      }
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

export default function MapView() {
  const [elevation, setElevation] = useState<ElevationState | null>(null);
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
      const parsed = JSON.parse(geoJsonText) as GeoJsonObject;
      if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
        setGeoJsonError("GeoJSON として解釈できません (type がありません)");
        return;
      }
      setGeoJsonData(parsed);
      setGeoJsonKey((k) => k + 1);
    } catch {
      setGeoJsonError("JSON の構文が正しくありません");
    }
  }

  return (
    <div className="space-y-4">
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
        <p className="mb-2 text-xs text-slate-500">
          GeoJSON (FeatureCollection 等) を貼り付けると地図上に表示します。データはブラウザ内でのみ処理され、サーバへ送信されません。
        </p>
        <textarea
          value={geoJsonText}
          onChange={(e) => setGeoJsonText(e.target.value)}
          rows={5}
          placeholder='{"type":"FeatureCollection","features":[...]}'
          className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={applyGeoJson}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            🗺️ 地図に表示
          </button>
          <button
            onClick={() => {
              setGeoJsonText("");
              setGeoJsonData(null);
              setGeoJsonError(null);
            }}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            クリア
          </button>
          {geoJsonError && <p className="text-sm text-red-600">⚠️ {geoJsonError}</p>}
        </div>
      </div>
    </div>
  );
}
