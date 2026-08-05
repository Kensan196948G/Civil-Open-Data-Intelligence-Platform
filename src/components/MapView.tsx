"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, Marker, Polyline, Polygon, TileLayer, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { icon as leafletIcon } from "leaflet";
import type { Feature, FeatureCollection, GeoJsonObject } from "geojson";
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

type ManagedLayer = {
  layerId: string;
  sourceId: string;
  title: string;
  category: string;
  color: string;
  visible: boolean;
  opacity: number;
  featureCount: number | null;
  filteredCount?: number;
  geoJson: GeoJsonObject | null;
  error: string | null;
};

const LAYER_COLORS = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f"];

function haversineMeters(a: [number, number], b: [number, number]) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function measureLength(points: [number, number][]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

function measureArea(points: [number, number][]) {
  if (points.length < 3) return 0;
  const meterPerDegLat = 111_320;
  const meterPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    sum += lng1 * meterPerDegLng(lat1) * lat2 * meterPerDegLat - lat1 * meterPerDegLat * lng2 * meterPerDegLng(lat2);
  }
  return Math.abs(sum / 2);
}

function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function formatArea(squareMeters: number) {
  return squareMeters >= 1_000_000
    ? `${(squareMeters / 1_000_000).toFixed(2)} km²`
    : `${Math.round(squareMeters)} m²`;
}

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
  const [layers, setLayers] = useState<ManagedLayer[]>([]);
  const [layerMessage, setLayerMessage] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([]);
  const [measureShape, setMeasureShape] = useState<"line" | "polygon">("line");
  const [bboxMode, setBboxMode] = useState(false);
  const [bboxPoints, setBboxPoints] = useState<[number, number][]>([]);
  const [attributeQuery, setAttributeQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ recordId: string; title: string; sourceUrl: string; category: string }>>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/layers?limit=200")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled || !Array.isArray(body?.data?.layers)) return;
        const catalogLayers: ManagedLayer[] = body.data.layers.map(
          (layer: {
            layerId: string;
            sourceId: string;
            title: string;
            category: string;
            featureCount: number | null;
          }, index: number) => ({
            layerId: layer.layerId,
            sourceId: layer.sourceId,
            title: layer.title,
            category: layer.category,
            color: LAYER_COLORS[index % LAYER_COLORS.length],
            visible: false,
            opacity: 0.8,
            featureCount: layer.featureCount ?? null,
            geoJson: null,
            error: null,
          }),
        );
        setLayers(catalogLayers);
      })
      .catch(() => {
        if (!cancelled) setLayerMessage("⚠️ レイヤー一覧を取得できませんでした");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markerPosition = useMemo(
    () => (mapClick ? ([Number(mapClick.lat), Number(mapClick.lng)] as [number, number]) : null),
    [mapClick],
  );

  function handleMapClick(latNum: number, lngNum: number) {
    if (bboxMode) {
      setBboxPoints((current) => {
        const next = [...current, [latNum, lngNum] as [number, number]];
        if (next.length === 2) {
          const [a, b] = next;
          const bbox = [Math.min(a[1], b[1]), Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[0], b[0])] as [
            number,
            number,
            number,
            number,
          ];
          void applyBbox(bbox);
          return [];
        }
        return next;
      });
      return;
    }
    if (measuring) {
      setMeasurePoints((current) => [...current, [latNum, lngNum]]);
      return;
    }
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

  async function toggleLayer(layerId: string) {
    setLayerMessage("");
    setLayers((current) =>
      current.map((layer) => (layer.layerId === layerId ? { ...layer, visible: !layer.visible } : layer)),
    );
    const target = layers.find((layer) => layer.layerId === layerId);
    if (!target || target.geoJson) return;
    try {
      const response = await fetch(`/api/v1/layers/${target.sourceId}/features?limit=2000`);
      const body = await response.json();
      const features = body?.data?.features ?? body?.features;
      if (!response.ok || !features) {
        throw new Error("features を取得できませんでした");
      }
      const collection: FeatureCollection = {
        type: "FeatureCollection",
        features: features as Feature[],
      };
      setLayers((current) =>
        current.map((layer) =>
          layer.layerId === layerId
            ? {
                ...layer,
                geoJson: collection,
                featureCount: Array.isArray(features) ? features.length : layer.featureCount,
              }
            : layer,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "取得に失敗しました";
      setLayers((current) =>
        current.map((layer) => (layer.layerId === layerId ? { ...layer, error: message } : layer)),
      );
      setLayerMessage(`⚠️ ${message}`);
    }
  }

  function setLayerOpacity(layerId: string, opacity: number) {
    setLayers((current) =>
      current.map((layer) => (layer.layerId === layerId ? { ...layer, opacity } : layer)),
    );
  }

  function exportGeoJson() {
    const features = layers
      .filter((layer) => layer.visible && layer.geoJson)
      .flatMap((layer) => {
        const data = layer.geoJson as FeatureCollection | null;
        if (!data) return [];
        return data.features.map((feature) => ({
          ...feature,
          properties: { ...feature.properties, layer: layer.title, sourceLayerId: layer.layerId },
        }));
      });
    const collection: FeatureCollection = { type: "FeatureCollection", features };
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "codip-export.geojson";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const rows: Record<string, unknown>[] = [];
    for (const layer of layers) {
      if (!layer.visible || !layer.geoJson) continue;
      const data = layer.geoJson as FeatureCollection | null;
      for (const feature of data?.features ?? []) {
        const geometry = feature.geometry as { type?: string; coordinates?: unknown } | null;
        let lng: unknown = "";
        let lat: unknown = "";
        if (geometry?.type === "Point" && Array.isArray(geometry.coordinates)) {
          lng = geometry.coordinates[0];
          lat = geometry.coordinates[1];
        }
        rows.push({
          layer: layer.title,
          category: layer.category,
          lng,
          lat,
          ...(feature.properties ?? {}),
        });
      }
    }
    if (rows.length === 0) return;
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => escape(row[key])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "codip-export.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function clearMeasurement() {
    setMeasurePoints([]);
    setMeasuring(false);
  }

  async function applyBbox(bbox: [number, number, number, number]) {
    setLayerMessage("");
    setBboxMode(false);
    setBboxPoints([]);
    const updated = [...layers];
    for (let index = 0; index < updated.length; index++) {
      const layer = updated[index];
      if (!layer.visible) continue;
      try {
        const response = await fetch(
          `/api/v1/layers/${layer.sourceId}/features?bbox=${bbox.join(",")}&limit=2000`,
        );
        const body = await response.json();
        const features = body?.data?.features ?? body?.features;
        if (!response.ok || !features) throw new Error("features を取得できませんでした");
        const collection: FeatureCollection = { type: "FeatureCollection", features: features as Feature[] };
        updated[index] = {
          ...layer,
          geoJson: collection,
          featureCount: Array.isArray(features) ? features.length : layer.featureCount,
          error: null,
        };
      } catch (error) {
        updated[index] = { ...layer, error: error instanceof Error ? error.message : "取得失敗" };
      }
    }
    setLayers(updated);
    setLayerMessage(`🔲 矩形検索を適用: ${bbox.join(", ")}`);
  }

  async function runAttributeSearch() {
    const q = attributeQuery.trim();
    if (q.length < 2) {
      setSearchMessage("⚠️ 2文字以上で入力してください");
      return;
    }
    try {
      const response = await fetch(`/api/v1/records/search?q=${encodeURIComponent(q)}&limit=20`);
      const body = await response.json();
      const records = body?.data?.records ?? [];
      setSearchResults(
        records.map((record: { recordId: string; title: string; sourceUrl: string; category: string }) => ({
          recordId: record.recordId,
          title: record.title,
          sourceUrl: record.sourceUrl,
          category: record.category,
        })),
      );
      setSearchMessage(`✅ ${records.length}件見つかりました`);
    } catch {
      setSearchMessage("⚠️ 検索に失敗しました");
    }
  }

  function inTimeRange(feature: Feature): boolean {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const observed = String(props.observedAt ?? props.publishedAt ?? props.retrievedAt ?? "");
    if (!observed) return true;
    const value = new Date(observed).getTime();
    if (Number.isNaN(value)) return true;
    if (timeFrom && value < new Date(timeFrom).getTime()) return false;
    if (timeTo && value > new Date(timeTo).getTime()) return false;
    return true;
  }

  const visibleGeoJsonLayers = layers.filter((layer) => layer.visible && layer.geoJson);
  const filteredLayers = useMemo(
    () =>
      visibleGeoJsonLayers.map((layer) => {
        const collection = layer.geoJson as FeatureCollection;
        const features = collection.features.filter(inTimeRange);
        return {
          ...layer,
          geoJson: { ...collection, features } as GeoJsonObject,
          filteredCount: features.length,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleGeoJsonLayers, timeFrom, timeTo],
  );
  const measuredLength = useMemo(() => measureLength(measurePoints), [measurePoints]);
  const measuredArea = useMemo(() => measureArea(measurePoints), [measurePoints]);

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
          {measurePoints.length > 0 && measureShape === "line" && (
            <Polyline positions={measurePoints} pathOptions={{ color: "#f59e0b", weight: 3 }} />
          )}
          {measurePoints.length >= 3 && measureShape === "polygon" && (
            <Polygon positions={measurePoints} pathOptions={{ color: "#f59e0b", weight: 3, fillOpacity: 0.15 }} />
          )}
          {filteredLayers.map((layer) => (
            <GeoJSON
              key={layer.layerId}
              data={layer.geoJson as GeoJsonObject}
              style={{ color: layer.color, weight: 2, opacity: layer.opacity, fillOpacity: layer.opacity * 0.3 }}
            />
          ))}
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

      {measurePoints.length > 0 && (
        <div className="max-w-[320px] rounded-lg border border-[var(--line)] bg-white px-[13px] py-2.5 text-[12.5px] shadow-[var(--shadow)]">
          <div>
            📏 計測ポイント: {measurePoints.length} 件
          </div>
          {measureShape === "line" && <div>📐 距離: {formatDistance(measuredLength)}</div>}
          {measureShape === "polygon" && (
            <>
              <div>📐 周長: {formatDistance(measuredLength)}</div>
              <div>🗺️ 面積: {formatArea(measuredArea)}</div>
            </>
          )}
          <button type="button" onClick={clearMeasurement} className="dc-btn-ghost mt-1">
            クリア
          </button>
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMeasureShape("line");
              setMeasuring((current) => !current);
              setMeasurePoints([]);
            }}
            className="dc-btn-ghost"
          >
            {measuring && measureShape === "line" ? "🛑 距離計測を終了" : "📏 距離計測"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMeasureShape("polygon");
              setMeasuring((current) => !current);
              setMeasurePoints([]);
            }}
            className="dc-btn-ghost"
          >
            {measuring && measureShape === "polygon" ? "🛑 面積計測を終了" : "🗺️ 面積計測"}
          </button>
          <button
            type="button"
            onClick={() => {
              setBboxMode((current) => !current);
              setBboxPoints([]);
            }}
            className="dc-btn-ghost"
          >
            {bboxMode ? "🛑 矩形検索を終了" : "🔲 矩形検索"}
          </button>
          <button type="button" onClick={exportGeoJson} className="dc-btn-ghost" disabled={visibleGeoJsonLayers.length === 0}>
            ⬇️ GeoJSON出力
          </button>
          <button type="button" onClick={exportCsv} className="dc-btn-ghost" disabled={visibleGeoJsonLayers.length === 0}>
            ⬇️ CSV出力
          </button>
        </div>
        {bboxMode && (
          <p className="mb-2 mt-0 text-[11.5px] text-[var(--amber)]" role="status">
            🔲 地図上で2点をクリックして矩形範囲を指定してください（現在 {bboxPoints.length} 点）
          </p>
        )}

        <h2 className="mb-2 mt-0 text-sm font-semibold text-[var(--ink)]">🗂️ データレイヤー</h2>
        <p className="mb-2 mt-0 text-[11.5px] text-[var(--muted)]">
          `/api/v1/layers` のレイヤーを選択すると地図に重ね合わせできます（データはブラウザ内で処理）。
        </p>
        <div className="max-h-[260px] overflow-auto rounded-lg border border-[var(--line)] p-2">
          {layers.length === 0 && <p className="m-0 text-[11.5px] text-[var(--faint)]">レイヤーを読み込み中...</p>}
          {layers.map((layer) => (
            <div key={layer.layerId} className="mb-2 flex flex-col gap-1 border-b border-[var(--line)] pb-2 last:border-0">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => toggleLayer(layer.layerId)}
                  aria-label={`${layer.title} を表示`}
                />
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: layer.color }} aria-hidden="true" />
                <span className="font-medium">{layer.title}</span>
                <span className="ml-auto text-[10.5px] text-[var(--faint)]">
                  {layer.featureCount != null
                    ? layer.filteredCount != null
                      ? `${layer.filteredCount}/${layer.featureCount}件`
                      : `${layer.featureCount}件`
                    : "未投入"}
                </span>
              </label>
              {layer.visible && (
                <label className="flex items-center gap-2 pl-5 text-[11px] text-[var(--muted)]">
                  透明度
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={layer.opacity}
                    onChange={(event) => setLayerOpacity(layer.layerId, Number(event.target.value))}
                    aria-label={`${layer.title} の透明度`}
                  />
                  <span>{Math.round(layer.opacity * 100)}%</span>
                </label>
              )}
              {layer.error && <span className="pl-5 text-[11px] text-[var(--danger)]">{layer.error}</span>}
            </div>
          ))}
        </div>
        {layerMessage && <p className="mt-1 text-[11.5px] text-[var(--danger)]">{layerMessage}</p>}

        <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--ink)]">🔎 属性検索・時間フィルタ</h2>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="属性検索キーワード"
            placeholder="例: 浸水 / 橋梁 / 横浜"
            className="dc-input box-border w-56 text-xs"
            value={attributeQuery}
            onChange={(event) => setAttributeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runAttributeSearch();
            }}
          />
          <button type="button" onClick={() => void runAttributeSearch()} className="dc-btn-ghost">
            🔎 検索
          </button>
          <label className="flex items-center gap-1 text-[11.5px] text-[var(--muted)]">
            開始
            <input
              type="date"
              aria-label="時間フィルタ開始日"
              value={timeFrom}
              onChange={(event) => setTimeFrom(event.target.value)}
              className="dc-input text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-[11.5px] text-[var(--muted)]">
            終了
            <input
              type="date"
              aria-label="時間フィルタ終了日"
              value={timeTo}
              onChange={(event) => setTimeTo(event.target.value)}
              className="dc-input text-xs"
            />
          </label>
        </div>
        {searchMessage && <p className="mb-1 text-[11.5px] text-[var(--muted)]">{searchMessage}</p>}
        {searchResults.length > 0 && (
          <ul className="m-0 mb-2 max-h-44 list-none overflow-auto rounded-lg border border-[var(--line)] p-2">
            {searchResults.map((record) => (
              <li key={record.recordId} className="mb-1 text-[12px]">
                <a
                  href={record.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--blue)] hover:underline"
                >
                  {record.title}
                </a>
                <span className="ml-2 text-[10.5px] text-[var(--faint)]">{record.category}</span>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--ink)]">📐 GeoJSON オーバーレイ</h2>
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
