"use client";

import { useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { icon as leafletIcon } from "leaflet";
import type { GeoJsonObject } from "geojson";
import "leaflet/dist/leaflet.css";

// Leaflet 既定ピン。PNG の static import は Next の image loader (WASM) を通り
// 本環境の WASM メモリ制限でビルド不能なため、public/leaflet/ の静的配信を URL 参照する
// (next/font・app icon 規約と同根の環境制約。アセットは leaflet 同梱物のコピー)
const defaultIcon = leafletIcon({
  iconUrl: "/leaflet/marker-icon.png",
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  shadowUrl: "/leaflet/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

type MapClick = { lat: string; lng: string; loading: boolean; elevation: number | null };

// デザイン正本 (script 4658-4660 行) と同一のシミュレーション標高。
// モック完全一致の人間判断 (2026-07-18) により実標高 API 呼び出しは行わない
// (/api/map/elevation はサーバー側 API として残置)
function simulateElevation(lat: number, lng: number): number {
  return Math.round(Math.abs(Math.sin(lat * 3) * Math.cos(lng * 3)) * 380 + 5);
}

// RFC 7946 の GeoJSON type 一覧。構文上有効な JSON との区別に使う
const GEOJSON_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function isGeoJsonObject(value: unknown): value is GeoJsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    GEOJSON_TYPES.has((value as { type?: unknown }).type as string)
  );
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapView() {
  const mapRef = useRef<LeafletMap | null>(null);
  const [mapClick, setMapClick] = useState<MapClick | null>(null);
  const [geoJsonText, setGeoJsonText] = useState("");
  const [geoJsonMessage, setGeoJsonMessage] = useState("");
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonObject | null>(null);
  const [geoJsonVersion, setGeoJsonVersion] = useState(0);

  const markerPosition = useMemo(
    () => (mapClick ? ([Number(mapClick.lat), Number(mapClick.lng)] as [number, number]) : null),
    [mapClick],
  );

  function handleMapClick(latNum: number, lngNum: number) {
    const lat = latNum.toFixed(5);
    const lng = lngNum.toFixed(5);
    setMapClick({ lat, lng, loading: true, elevation: null });
    // デザイン正本と同じ 700ms 遅延でシミュレーション値を表示する
    setTimeout(() => {
      setMapClick((current) =>
        current && current.lat === lat && current.lng === lng
          ? { ...current, loading: false, elevation: simulateElevation(Number(lat), Number(lng)) }
          : current,
      );
    }, 700);
  }

  function applyGeoJson() {
    if (!geoJsonText.trim()) {
      setGeoJsonMessage("");
      return;
    }
    try {
      const data = JSON.parse(geoJsonText) as unknown;
      // 構文上有効な JSON でも GeoJSON でない値 ({} や [] 等) は Leaflet の
      // 描画層で例外になりうるため、type を構造検証してから反映する
      if (!isGeoJsonObject(data)) {
        setGeoJsonMessage("⚠️ GeoJSON として解釈できません (type を確認してください)");
        return;
      }
      setGeoJsonData(data);
      setGeoJsonVersion((v) => v + 1);
      setGeoJsonMessage("✅ 地図に反映しました");
    } catch {
      setGeoJsonMessage("⚠️ JSON の構文が正しくありません");
    }
  }

  function clearGeoJson() {
    setGeoJsonData(null);
    setGeoJsonText("");
    setGeoJsonMessage("");
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="h-[460px] overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        <MapContainer center={[36.2, 138.2]} zoom={6} scrollWheelZoom className="h-full w-full" ref={mapRef}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
            maxZoom={19}
          />
          <ClickHandler onClick={handleMapClick} />
          {markerPosition && <Marker position={markerPosition} icon={defaultIcon} />}
          {geoJsonData && (
            <GeoJSON
              key={geoJsonVersion}
              data={geoJsonData}
              style={{ color: "#dc2626", weight: 2 }}
              eventHandlers={{
                add: (e) => {
                  try {
                    mapRef.current?.fitBounds(
                      (e.target as { getBounds: () => import("leaflet").LatLngBounds }).getBounds(),
                      { maxZoom: 14 },
                    );
                  } catch {
                    // 点のみ等で bounds が取れない場合は現在の表示位置を維持する
                  }
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      {mapClick && (
        <div
          role="status"
          className="max-w-[320px] rounded-lg border border-[var(--line)] bg-white px-[13px] py-2.5 text-[12.5px] shadow-[var(--shadow)]"
        >
          <div>
            📍 {mapClick.lat}, {mapClick.lng}
          </div>
          <div>
            {mapClick.loading
              ? "⏳ 標高取得中..."
              : `⛰️ 標高目安: ${mapClick.elevation} m（シミュレーション値）`}
          </div>
        </div>
      )}

      <p className="m-0 text-[11px] text-[var(--faint)]">
        🏷️ 出典: 地図データは{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>{" "}
        の貢献者によって提供されています（© OpenStreetMap
        contributors）。標高値はプレビュー環境のためシミュレーションです。
      </p>

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2 mt-0 text-sm font-semibold text-[var(--ink)]">📐 GeoJSON オーバーレイ</h2>
        <p className="mb-2 mt-0 text-[11.5px] text-[var(--muted)]">
          GeoJSON (FeatureCollection 等)
          を貼り付けると地図上に表示します。データはブラウザ内でのみ処理されます。
        </p>
        <textarea
          rows={4}
          aria-label="GeoJSONデータ"
          placeholder='{"type":"FeatureCollection","features":[...]}'
          className="dc-input box-border w-full text-xs"
          style={{ fontFamily: "var(--mono)" }}
          value={geoJsonText}
          onChange={(e) => setGeoJsonText(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={applyGeoJson}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--blue)] bg-[var(--blue)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--blue-2)]"
          >
            🗺️ 地図に表示
          </button>
          <button type="button" onClick={clearGeoJson} className="dc-btn-ghost">
            クリア
          </button>
          <span className="text-[12.5px]" role="status">
            {geoJsonMessage}
          </span>
        </div>
      </div>
    </div>
  );
}
