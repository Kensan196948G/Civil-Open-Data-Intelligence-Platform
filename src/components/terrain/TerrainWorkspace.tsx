"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TerrainMapView, type MapFocusRequest, type SectionLineState } from "./MapView";
import { parseMapState, serializeMapState, type MapViewState } from "./map-state";
import { BASE_LAYERS, OVERLAY_LAYERS } from "./layers";
import { parseSearchQuery } from "./site-search";
import { QualityPanel } from "./QualityPanel";
import { SectionProfileChart } from "./SectionProfileChart";
import { formatDeg, formatPercent } from "@/lib/terrain/format";

type TabId = "terrain" | "section" | "confirm" | "output";

type ElevationResult =
  | { kind: "ok"; elevationM: number; source: string; quality: { grade: string } }
  | { kind: "no-coverage" }
  | { kind: "error"; message: string };

type TerrainResult =
  | { kind: "ok"; stats: { meanDeg: number; maxDeg: number; steepRatio: number; validCount: number; evaluatedCount: number } | null; classes: { counts: Record<string, number>; classified: number; unknown: number }; quality: { grade: string; missingRatio: number; warnings: string[]; sourceMix: Record<string, number> }; provenance: Array<{ sourceId: string; sourceName: string; termsUrl: string }>; extentM: number }
  | { kind: "no-coverage" }
  | { kind: "unavailable" }
  | { kind: "error" };

type SectionResult =
  | { kind: "ok"; samples: Array<{ distanceM: number; elevationM: number | null }>; stats: { totalLengthM: number; gainM: number; lossM: number; meanSlopeDeg: number | null; maxSlopeDeg: number | null; validSampleRatio: number; sampleCount: number }; quality: { grade: string; missingRatio: number; warnings: string[]; sourceMix: Record<string, number> }; provenance: Array<{ sourceId: string; sourceName: string; termsUrl: string }> }
  | { kind: "too-short"; lengthM: number }
  | { kind: "too-long"; lengthM: number }
  | { kind: "no-coverage" }
  | { kind: "unavailable" }
  | { kind: "error" };

type ConfirmResult = {
  cards: Array<{ code: string; status: string; title: string; observation: string; recommendedChecks: string[] }>;
  passedCount: number;
  skippedCount: number;
};

function formatMeters(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value.toFixed(0)} m`;
}

const CLASS_LEGEND = [
  { key: "ridge", label: "尾根", color: "#2563eb" },
  { key: "slope", label: "斜面", color: "#16a34a" },
  { key: "valley", label: "谷", color: "#d97706" },
  { key: "flat", label: "平坦", color: "#7c3aed" },
] as const;

export function TerrainWorkspace() {
  const initial = useMemo(() => parseMapState(typeof window === "undefined" ? "" : window.location.hash), []);
  const [view, setView] = useState<MapViewState>(initial.view);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lon: number } | null>(initial.point);
  const [tab, setTab] = useState<TabId>(initial.tab === "section" || initial.tab === "confirm" || initial.tab === "output" ? initial.tab : "terrain");
  const [focus, setFocus] = useState<MapFocusRequest | null>(null);
  const [sectionLine, setSectionLine] = useState<SectionLineState | null>(null);
  const [sectionPicking, setSectionPicking] = useState<"idle" | "start" | "end">("idle");
  const [elevation, setElevation] = useState<ElevationResult | null>(null);
  const [terrain, setTerrain] = useState<TerrainResult | null>(null);
  const [section, setSection] = useState<SectionResult | null>(null);
  const [confirm, setConfirm] = useState<ConfirmResult | null>(null);
  const [terrainLoading, setTerrainLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedRuns, setSavedRuns] = useState<Array<{ id: string; lat: number; lon: number; tab: string; createdAt: string }>>([]);
  const [saveMessage, setSaveMessage] = useState("");

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = serializeMapState(view, { point: selectedPoint, tab });
    return `${window.location.origin}${window.location.pathname}#${params}`;
  }, [view, selectedPoint, tab]);

  useEffect(() => {
    const params = serializeMapState(view, { point: selectedPoint, tab });
    if (window.location.hash !== `#${params}`) {
      window.history.replaceState(null, "", `#${params}`);
    }
  }, [view, selectedPoint, tab]);

  const fetchElevation = useCallback(async (coordinate: { lat: number; lon: number }) => {
    setElevation({ kind: "error", message: "" });
    try {
      const response = await fetch(
        `/api/v1/terrain/elevation?lat=${coordinate.lat}&lon=${coordinate.lon}`,
      );
      const body = await response.json();
      if (!response.ok) {
        setElevation(
          body?.error?.code === "no_coverage"
            ? { kind: "no-coverage" }
            : { kind: "error", message: body?.error?.message ?? "取得に失敗しました" },
        );
        return;
      }
      setElevation({
        kind: "ok",
        elevationM: body.data.elevationM,
        source: body.data.source,
        quality: body.data.quality,
      });
    } catch {
      setElevation({ kind: "error", message: "標高取得に失敗しました" });
    }
  }, []);

  function handleMapClick(coordinate: { lat: number; lon: number }) {
    setSelectedPoint(coordinate);
    const currentLine = sectionLine;
    if (sectionPicking === "start") {
      setSectionLine({ start: coordinate, end: null });
      setSectionPicking("end");
      setMessage("断面の終点をクリックしてください");
      return;
    }
    if (sectionPicking === "end" && currentLine !== null && currentLine.start !== null) {
      setSectionLine({ start: currentLine.start, end: coordinate });
      setSectionPicking("idle");
      setMessage("");
      return;
    }
    void fetchElevation(coordinate);
  }

  function handleSearch() {
    const resolution = parseSearchQuery(query);
    if (resolution.kind === "empty") {
      setSearchError("検索語を入力してください");
      return;
    }
    if (resolution.kind === "not-found") {
      setSearchError("該当する地点が見つかりませんでした (地名は目印のみ対応)");
      return;
    }
    setSearchError(null);
    const coordinate = resolution.coordinate;
    setSelectedPoint(coordinate);
    setFocus({ coordinate, zoom: Math.max(view.zoom, 12), token: Date.now() });
    void fetchElevation(coordinate);
  }

  async function runTerrain() {
    if (selectedPoint === null) return;
    setTerrainLoading(true);
    setTerrain(null);
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/terrain/analysis?lat=${selectedPoint.lat}&lon=${selectedPoint.lon}`,
      );
      const body = await response.json();
      if (!response.ok) {
        setTerrain(body?.error?.code === "no_coverage" ? { kind: "no-coverage" } : { kind: "unavailable" });
        return;
      }
      setTerrain(body.data as TerrainResult);
    } catch {
      setTerrain({ kind: "error" });
    } finally {
      setTerrainLoading(false);
    }
  }

  async function runSection() {
    if (sectionLine === null || sectionLine.start === null || sectionLine.end === null) return;
    setSectionLoading(true);
    setSection(null);
    setMessage("");
    try {
      const { start, end } = sectionLine;
      const response = await fetch(
        `/api/v1/terrain/section?startLat=${start.lat}&startLon=${start.lon}&endLat=${end.lat}&endLon=${end.lon}`,
      );
      const body = await response.json();
      if (!response.ok) {
        if (body?.error?.code === "analysis_area_too_small") {
          setSection({ kind: "too-short", lengthM: 0 });
        } else if (body?.error?.code === "analysis_area_too_large") {
          setSection({ kind: "too-long", lengthM: 0 });
        } else {
          setSection(body?.error?.code === "no_coverage" ? { kind: "no-coverage" } : { kind: "unavailable" });
        }
        return;
      }
      setSection(body.data as SectionResult);
    } catch {
      setSection({ kind: "error" });
    } finally {
      setSectionLoading(false);
    }
  }

  async function runConfirm() {
    if (selectedPoint === null) return;
    setConfirmLoading(true);
    setConfirm(null);
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/terrain/confirm?lat=${selectedPoint.lat}&lon=${selectedPoint.lon}`,
      );
      const body = await response.json();
      if (!response.ok) {
        setMessage("確認支援カードの取得に失敗しました");
        return;
      }
      setConfirm(body.data as ConfirmResult);
    } catch {
      setMessage("確認支援カードの取得に失敗しました");
    } finally {
      setConfirmLoading(false);
    }
  }

  function copyShareUrl() {
    void navigator.clipboard?.writeText(shareUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setMessage("共有URLのコピーに失敗しました"),
    );
  }

  async function loadSavedRuns() {
    try {
      const response = await fetch("/api/v1/terrain/runs?limit=20");
      const body = await response.json();
      setSavedRuns(body?.data?.runs ?? []);
    } catch {
      setSaveMessage("保存済み案件の取得に失敗しました");
    }
  }

  useEffect(() => {
    void loadSavedRuns();
  }, []);

  async function saveRun() {
    if (selectedPoint === null) return;
    setSaveMessage("");
    const payload =
      tab === "terrain" && terrain?.kind === "ok"
        ? terrain
        : tab === "section" && section?.kind === "ok"
          ? section
          : tab === "confirm" && confirm !== null
            ? { confirm, point: selectedPoint }
            : { point: selectedPoint };
    const response = await fetch("/api/v1/terrain/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: selectedPoint.lat, lon: selectedPoint.lon, tab, payload }),
    });
    const body = await response.json();
    if (!response.ok) {
      setSaveMessage(body?.error?.message ?? "案件保存に失敗しました (管理認証が必要です)");
      return;
    }
    setSaveMessage("✅ 案件を保存しました");
    void loadSavedRuns();
  }

  const exportUrl = (format: "markdown" | "csv" | "json") =>
    selectedPoint === null
      ? null
      : `/api/v1/terrain/export?lat=${selectedPoint.lat}&lon=${selectedPoint.lon}&format=${format}`;

  const canRunSection = sectionLine !== null && sectionLine.start !== null && sectionLine.end !== null;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            handleSearch();
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="住所・地名・緯度,経度で検索 (例: 富士山)"
            aria-label="地点検索"
            className="dc-input box-border w-72 text-xs"
          />
          <button type="submit" className="dc-btn-ghost">
            🔍 検索
          </button>
        </form>
        <label className="flex items-center gap-1 text-[11.5px] text-[var(--muted)]">
          ベース
          <select
            value={view.base}
            onChange={(event) => setView((current) => ({ ...current, base: event.currentTarget.value as MapViewState["base"] }))}
            className="dc-input text-xs"
            aria-label="ベースレイヤー"
          >
            {BASE_LAYERS.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.label}
              </option>
            ))}
          </select>
        </label>
        {OVERLAY_LAYERS.map((layer) => (
          <label key={layer.id} className="flex items-center gap-1 text-[11.5px] text-[var(--muted)]">
            <input
              type="checkbox"
              checked={view.overlays.includes(layer.id)}
              onChange={(event) =>
                setView((current) => ({
                  ...current,
                  overlays: event.currentTarget.checked
                    ? [...current.overlays, layer.id]
                    : current.overlays.filter((id) => id !== layer.id),
                }))
              }
              aria-label={`${layer.label}を表示`}
            />
            {layer.label}
          </label>
        ))}
      </div>
      {searchError !== null ? <p className="m-0 text-[11.5px] text-[var(--danger)]" role="alert">{searchError}</p> : null}

      <div className="h-[480px] overflow-hidden rounded-[var(--radius)] border border-[var(--line)]">
        <TerrainMapView
          view={view}
          onViewChange={setView}
          onMapClick={handleMapClick}
          selectedPoint={selectedPoint}
          sectionLine={sectionLine}
          focus={focus}
        />
      </div>

      <p className="m-0 text-[11px] text-[var(--faint)]">
        🏷️ 地図: 国土地理院タイル (標準・淡色・写真・傾斜量図・陰影起伏図) / 標高: 国土地理院 標高タイル。出典表記は地図の帰属表示に常設されます。
      </p>

      {elevation !== null ? (
        <div role="status" className="rounded-lg border border-[var(--line)] bg-white px-[13px] py-2.5 text-[12.5px] shadow-[var(--shadow)]">
          {selectedPoint !== null ? (
            <>
              📍 緯度 {selectedPoint.lat.toFixed(5)} / 経度 {selectedPoint.lon.toFixed(5)}
              {elevation.kind === "ok" ? (
                <> ・ ⛰️ 標高 {elevation.elevationM.toFixed(2)} m (ソース: {elevation.source}, 品質: {elevation.quality.grade})</>
              ) : elevation.kind === "no-coverage" ? (
                <> ・ ⚠️ この地点の DEM データはありません (データなし ≠ 安全)</>
              ) : (
                <> ・ ⚠️ {elevation.message || "標高取得に失敗しました (判定不能)"}</>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="dc-card px-[18px] py-[17px]">
        <div className="mb-3 flex flex-wrap gap-2">
          {(
            [
              ["terrain", "⛰️ 地形分析"],
              ["section", "📈 断面分析"],
              ["confirm", "⚠️ 確認支援"],
              ["output", "🧾 出力・共有"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={tab === id ? "dc-btn-primary" : "dc-btn-ghost"}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "terrain" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="dc-btn-accent" onClick={() => void runTerrain()} disabled={selectedPoint === null || terrainLoading}>
                {terrainLoading ? "⏳ 解析中..." : "🔍 地形解析を実行"}
              </button>
              {selectedPoint === null ? <span className="text-[11.5px] text-[var(--muted)]">地図をクリックして対象地点を指定してください</span> : null}
            </div>
            {terrain !== null ? renderTerrain(terrain) : null}
          </div>
        ) : null}

        {tab === "section" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="dc-btn-accent"
                onClick={() => {
                  if (sectionPicking === "idle") {
                    setSectionLine(null);
                    setSectionPicking("start");
                    setMessage("地図で断面の始点をクリックしてください");
                  } else {
                    setSectionPicking("idle");
                    setMessage("");
                  }
                }}
              >
                {sectionPicking === "idle" ? "📐 地図で断面線を指定" : "🛑 指定をやめる"}
              </button>
              <button
                type="button"
                className="dc-btn-accent"
                onClick={() => void runSection()}
                disabled={!canRunSection || sectionLoading}
              >
                {sectionLoading ? "⏳ 解析中..." : "📈 断面解析を実行"}
              </button>
              <span className="text-[11.5px] text-[var(--muted)]">
                {sectionPicking === "start"
                  ? "始点をクリックしてください"
                  : sectionPicking === "end"
                    ? "終点をクリックしてください"
                    : sectionLine?.start !== null && sectionLine?.end !== null
                      ? `断面線: ${formatMeters(0)} 以上・20km 以下`
                      : "断面線は30m〜20kmで指定できます"}
              </span>
            </div>
            {section !== null ? renderSection(section) : null}
          </div>
        ) : null}

        {tab === "confirm" ? (
          <div className="flex flex-col gap-3">
            <button type="button" className="dc-btn-accent w-fit" onClick={() => void runConfirm()} disabled={selectedPoint === null || confirmLoading}>
              {confirmLoading ? "⏳ 評価中..." : "⚠️ 確認支援カードを評価"}
            </button>
            {confirm !== null ? (
              <div className="flex flex-col gap-2">
                {confirm.cards.length === 0 ? (
                  <p className="m-0 text-[12px] text-[var(--muted)]">
                    しきい値を超過した項目はありません。これは安全の保証ではありません。
                  </p>
                ) : (
                  confirm.cards.map((card) => (
                    <div key={card.code} className="rounded-lg border border-[var(--line)] p-3">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-[var(--subtle)] px-1.5 py-0.5 text-[10.5px] font-semibold">{card.status}</span>
                        <h5 className="m-0 text-[13px] font-semibold">{card.title}</h5>
                      </div>
                      <p className="mb-1 mt-1 text-[12px]">{card.observation}</p>
                      {card.recommendedChecks.length > 0 ? (
                        <p className="m-0 text-[11.5px] text-[var(--muted)]">推奨: {card.recommendedChecks.join(" / ")}</p>
                      ) : null}
                    </div>
                  ))
                )}
                <p className="m-0 text-[11px] text-[var(--muted)]">
                  しきい値未達 {confirm.passedCount} 件 / 未評価 {confirm.skippedCount} 件。総合危険度の合算は行いません。
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "output" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {(["markdown", "csv", "json"] as const).map((format) => {
                const url = exportUrl(format);
                return (
                  <a
                    key={format}
                    href={url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={url === null ? "pointer-events-none opacity-40" : ""}
                    aria-disabled={url === null}
                  >
                    <button type="button" className="dc-btn-ghost" disabled={url === null}>
                      ⬇️ レポート出力 ({format.toUpperCase()})
                    </button>
                  </a>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                aria-label="共有URL"
                onFocus={(event) => event.currentTarget.select()}
                className="dc-input box-border w-full max-w-xl text-xs"
              />
              <button type="button" className="dc-btn-ghost" onClick={copyShareUrl}>
                {copied ? "✅ コピー済み" : "📋 コピー"}
              </button>
            </div>
            <p className="m-0 text-[11px] text-[var(--muted)]">
              共有URLには視点・レイヤー・対象地点・タブのみを含みます。住所・履歴・自由記述は含まれません。
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
              <button type="button" className="dc-btn-accent" onClick={() => void saveRun()} disabled={selectedPoint === null}>
                💾 案件を保存 (管理認証必須)
              </button>
              <span className="text-[11.5px] text-[var(--muted)]">{saveMessage}</span>
            </div>
            <div>
              <h3 className="mb-2 mt-0 text-[13px] font-semibold">保存済み案件 (直近20件)</h3>
              {savedRuns.length === 0 ? (
                <p className="m-0 text-[11.5px] text-[var(--muted)]">保存済み案件はありません。</p>
              ) : (
                <ul className="m-0 max-h-52 list-none overflow-auto p-0">
                  {savedRuns.map((run) => (
                    <li key={run.id} className="border-b border-[var(--line)] py-1 text-[11.5px] last:border-0">
                      <span className="font-mono">{new Date(run.createdAt).toLocaleString("ja-JP")}</span>
                      <span className="ml-2">
                        {run.lat.toFixed(5)}, {run.lon.toFixed(5)} / {run.tab}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {message !== "" ? <p className="m-0 text-[11.5px] text-[var(--amber)]" role="status">{message}</p> : null}
      </div>
    </div>
  );
}

function renderTerrain(result: TerrainResult) {
  if (result.kind === "no-coverage") {
    return (
      <p className="m-0 text-[12px] text-[var(--amber)]" role="note">
        この範囲の DEM データはありません。<strong>データが無いことは安全を意味しません。</strong>
      </p>
    );
  }
  if (result.kind !== "ok") {
    return (
      <p className="m-0 text-[12px] text-[var(--danger)]" role="note">
        DEM の取得に失敗しました。判定不能は安全を意味しません。
      </p>
    );
  }
  const stats = result.stats;
  const classes = result.classes;
  return (
    <>
      {stats !== null ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--line)] p-3">
            <div className="text-[11px] text-[var(--muted)]">平均傾斜</div>
            <div className="text-lg font-semibold">{formatDeg(stats.meanDeg)}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] p-3">
            <div className="text-[11px] text-[var(--muted)]">最大傾斜</div>
            <div className="text-lg font-semibold text-[var(--danger)]">{formatDeg(stats.maxDeg)}</div>
          </div>
          <div className="rounded-lg border border-[var(--line)] p-3">
            <div className="text-[11px] text-[var(--muted)]">急傾斜 (30°以上) 面積比</div>
            <div className="text-lg font-semibold">{formatPercent(stats.steepRatio)}</div>
          </div>
        </div>
      ) : (
        <p className="m-0 text-[12px] text-[var(--amber)]">有効な標高セルが不足しており、傾斜統計を計算できません (判定不能)。</p>
      )}
      <div className="rounded-lg border border-[var(--line)] p-3">
        <h4 className="mb-1 mt-0 text-[13px] font-semibold">地形分類 (TPI)・{classes.classified}セル評価</h4>
        <div className="mb-2 flex h-2 w-full overflow-hidden rounded">
          {classes.classified > 0
            ? CLASS_LEGEND.map(({ key, color }) => (
                <span
                  key={key}
                  style={{ width: `${((classes.counts[key] ?? 0) / classes.classified) * 100}%`, background: color }}
                />
              ))
            : null}
        </div>
        <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0 text-[12px] sm:grid-cols-4">
          {CLASS_LEGEND.map(({ key, label, color }) => (
            <li key={key} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              {label}: {classes.counts[key] ?? 0} ({formatPercent((classes.counts[key] ?? 0) / Math.max(classes.classified, 1))})
            </li>
          ))}
        </ul>
        {classes.unknown > 0 ? (
          <p className="mb-0 mt-2 text-[11px] text-[var(--muted)]">
            {classes.unknown} セルはデータ欠損の影響で分類できませんでした (判定不能は安全を意味しません)。
          </p>
        ) : null}
      </div>
      <QualityPanel quality={result.quality} provenance={result.provenance} />
    </>
  );
}

function renderSection(result: SectionResult) {
  if (result.kind === "too-short" || result.kind === "too-long") {
    return <p className="m-0 text-[12px] text-[var(--amber)]">断面線の長さは30m〜20kmで指定してください。</p>;
  }
  if (result.kind === "no-coverage") {
    return (
      <p className="m-0 text-[12px] text-[var(--amber)]" role="note">
        この断面の DEM データはありません。<strong>データが無いことは安全を意味しません。</strong>
      </p>
    );
  }
  if (result.kind !== "ok") {
    return (
      <p className="m-0 text-[12px] text-[var(--danger)]" role="note">
        DEM の取得に失敗しました。判定不能は安全を意味しません。
      </p>
    );
  }
  const stats = result.stats;
  return (
    <>
      <div className="rounded-lg border border-[var(--line)] p-3">
        <h4 className="mb-1 mt-0 text-[13px] font-semibold">縦断プロファイル</h4>
        <SectionProfileChart samples={result.samples} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-lg border border-[var(--line)] p-2">
          <div className="text-[10.5px] text-[var(--muted)]">総延長</div>
          <div className="text-sm font-semibold">{formatMeters(stats.totalLengthM)}</div>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-2">
          <div className="text-[10.5px] text-[var(--muted)]">累積上昇</div>
          <div className="text-sm font-semibold">{formatMeters(stats.gainM)}</div>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-2">
          <div className="text-[10.5px] text-[var(--muted)]">累積下降</div>
          <div className="text-sm font-semibold">{formatMeters(stats.lossM)}</div>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-2">
          <div className="text-[10.5px] text-[var(--muted)]">平均勾配</div>
          <div className="text-sm font-semibold">{formatDeg(stats.meanSlopeDeg)}</div>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-2">
          <div className="text-[10.5px] text-[var(--muted)]">最大勾配</div>
          <div className="text-sm font-semibold">{formatDeg(stats.maxSlopeDeg)}</div>
        </div>
      </div>
      <QualityPanel quality={result.quality} provenance={result.provenance} />
    </>
  );
}
