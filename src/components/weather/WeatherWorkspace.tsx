"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type TabId = "weather" | "marine" | "decision" | "sites" | "reports" | "etl";

type Site = {
  id: string;
  code: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  jmaStationId: string | null;
  address: string | null;
};

type WeatherRow = {
  observedAt: string;
  temperatureC: number | null;
  humidityPct: number | null;
  pressureHpa: number | null;
  precipMm: number | null;
  windSpeedMs: number | null;
  windGustMs: number | null;
  windDirDeg: number | null;
  sunshineH: number | null;
  source: string;
};

type MarineRow = {
  observedAt: string;
  sigWaveHM: number | null;
  wavePeriodS: number | null;
  waveDirDeg: number | null;
  tideLevelM: number | null;
  currentSpeedMs: number | null;
  currentDirDeg: number | null;
  source: string;
};

type DecisionResult = {
  id: string;
  workType: string;
  status: "go" | "caution" | "stop";
  reason: string;
  inputs: Record<string, number | null>;
  thresholdsSnapshot: Record<string, unknown>;
  generatedAt: string;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "weather", label: "🌦️ 気象" },
  { id: "marine", label: "🌊 海象" },
  { id: "decision", label: "🧭 施工判定" },
  { id: "sites", label: "🚧 現場管理" },
  { id: "reports", label: "📊 レポート" },
  { id: "etl", label: "⚙️ 取得状況" },
];

const WORK_TYPES = [
  { id: "concrete", label: "コンクリート打設" },
  { id: "crane", label: "クレーン作業" },
  { id: "marineLift", label: "海上揚重" },
  { id: "marineDive", label: "潜水作業" },
  { id: "marineTransport", label: "海上輸送" },
];

export function WeatherWorkspace({ initialTab }: { initialTab: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [weather, setWeather] = useState<WeatherRow[]>([]);
  const [marine, setMarine] = useState<MarineRow[]>([]);
  const [etl, setEtl] = useState<{ jobs: { id: number; name: string; status: string; records: number; lastObservedAt: string | null }[] } | null>(null);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<DecisionResult | null>(null);
  const [workType, setWorkType] = useState("concrete");
  const [windowStart, setWindowStart] = useState(defaultWindowStart());
  const [windowEnd, setWindowEnd] = useState(defaultWindowEnd());
  const [loading, setLoading] = useState(false);

  const loadSites = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/sites");
      const body = await response.json();
      const items = body?.data?.sites ?? [];
      setSites(items);
      setSiteId((current) => current || (items[0]?.id ?? ""));
    } catch {
      setMessage("現場一覧の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    void loadSites();
    void loadEtl();
  }, [loadSites]);

  async function loadEtl() {
    try {
      const response = await fetch("/api/v1/etl/status");
      const body = await response.json();
      setEtl(body?.data ?? null);
    } catch {
      // ETL状態は任意
    }
  }

  async function loadObservations() {
    if (!siteId) return;
    setMessage("");
    try {
      const [w, m] = await Promise.all([
        fetch(`/api/v1/observations/weather?siteId=${encodeURIComponent(siteId)}&limit=200`),
        fetch(`/api/v1/observations/marine?siteId=${encodeURIComponent(siteId)}&limit=200`),
      ]);
      const wb = await w.json();
      const mb = await m.json();
      setWeather(wb?.data?.observations ?? []);
      setMarine(mb?.data?.observations ?? []);
    } catch {
      setMessage("観測データの取得に失敗しました");
    }
  }

  async function runDecision() {
    if (!siteId) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId, workType, targetWindowStart: new Date(windowStart).toISOString(), targetWindowEnd: new Date(windowEnd).toISOString() }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body?.error?.message ?? "判定に失敗しました (管理認証が必要です)");
        return;
      }
      setDecision(body.data.decision);
    } catch {
      setMessage("判定に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function createSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = {
      code: String(form.get("code") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      kind: String(form.get("kind") ?? "land"),
      lat: Number(form.get("lat")),
      lon: Number(form.get("lon")),
      jmaStationId: String(form.get("jmaStationId") ?? "").trim() || null,
      address: String(form.get("address") ?? "").trim() || null,
    };
    const response = await fetch("/api/v1/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body?.error?.message ?? "現場登録に失敗しました (管理認証が必要です)");
      return;
    }
    setMessage("✅ 現場を登録しました");
    void loadSites();
  }

  function downloadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!siteId) return;
    const form = new FormData(event.currentTarget);
    const template = String(form.get("template") ?? "daily");
    const format = String(form.get("format") ?? "csv");
    const dateFrom = String(form.get("dateFrom") ?? "");
    const dateTo = String(form.get("dateTo") ?? "");
    fetch("/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, template, format, dateFrom, dateTo }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          setMessage(body?.error?.message ?? "レポート生成に失敗しました (管理認証が必要です)");
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `report-${template}.${format}`;
        anchor.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => setMessage("レポート生成に失敗しました"));
  }

  const windRose = useMemo(() => buildWindRose(weather), [weather]);
  const selectedSite = sites.find((s) => s.id === siteId);

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={tab === t.id ? "dc-btn-accent" : "dc-btn-ghost"}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
          現場
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="dc-input text-xs" aria-label="現場選択">
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code} {site.name} ({site.kind})
              </option>
            ))}
          </select>
        </label>
        {selectedSite ? (
          <span className="text-[11.5px] text-[var(--faint)]">
            📍 {selectedSite.lat.toFixed(5)}, {selectedSite.lon.toFixed(5)}
            {selectedSite.jmaStationId ? ` / AMeDAS ${selectedSite.jmaStationId}` : ""}
          </span>
        ) : null}
        <button type="button" className="dc-btn-ghost" onClick={() => void loadObservations()}>
          🔄 観測データ更新
        </button>
      </div>

      {tab === "weather" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="気温" value={weather[0]?.temperatureC} unit="℃" />
          <MetricCard label="湿度" value={weather[0]?.humidityPct} unit="%" />
          <MetricCard label="降水量 (10分)" value={weather[0]?.precipMm} unit="mm" />
          <MetricCard label="風速" value={weather[0]?.windSpeedMs} unit="m/s" />
          <div className="rounded-lg border border-[var(--line)] p-3 sm:col-span-2">
            <h3 className="mb-2 mt-0 text-[13px] font-semibold">風配図 (直近200件)</h3>
            <WindRose data={windRose} />
          </div>
          <div className="rounded-lg border border-[var(--line)] p-3 sm:col-span-2">
            <h3 className="mb-2 mt-0 text-[13px] font-semibold">最新観測の出典・時刻</h3>
            <p className="m-0 text-[12px] text-[var(--muted)]">
              {weather[0]
                ? `観測時刻: ${new Date(weather[0].observedAt).toLocaleString("ja-JP")} / ソース: ${weather[0].source} / 品質: QCフラグ0のみ採用`
                : "観測データがありません (取り込みジョブ未実行または未設定)"}
            </p>
            <p className="m-0 text-[11px] text-[var(--faint)]">出典: 気象庁 AMeDAS (https://www.jma.go.jp/bosai/amedas/)</p>
          </div>
        </div>
      ) : null}

      {tab === "marine" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="有義波高" value={marine[0]?.sigWaveHM} unit="m" />
          <MetricCard label="周期" value={marine[0]?.wavePeriodS} unit="s" />
          <MetricCard label="潮位" value={marine[0]?.tideLevelM} unit="m" />
          <MetricCard label="海流" value={marine[0]?.currentSpeedMs} unit="m/s" />
          <div className="rounded-lg border border-[var(--line)] p-3 sm:col-span-4">
            <h3 className="mb-2 mt-0 text-[13px] font-semibold">海象観測 (直近24h)</h3>
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-left text-[11.5px]">
                <thead>
                  <tr className="border-b border-[var(--line)] text-[var(--muted)]">
                    <th className="py-1 pr-2 font-medium">時刻</th>
                    <th className="py-1 pr-2 font-medium">波高</th>
                    <th className="py-1 pr-2 font-medium">周期</th>
                    <th className="py-1 pr-2 font-medium">波向</th>
                    <th className="py-1 pr-2 font-medium">潮位</th>
                    <th className="py-1 pr-2 font-medium">ソース</th>
                  </tr>
                </thead>
                <tbody>
                  {marine.slice(0, 50).map((row) => (
                    <tr key={row.observedAt + row.source} className="border-b border-[var(--line)]">
                      <td className="py-1 pr-2">{new Date(row.observedAt).toLocaleString("ja-JP")}</td>
                      <td className="py-1 pr-2">{row.sigWaveHM ?? "—"}</td>
                      <td className="py-1 pr-2">{row.wavePeriodS ?? "—"}</td>
                      <td className="py-1 pr-2">{row.waveDirDeg ?? "—"}</td>
                      <td className="py-1 pr-2">{row.tideLevelM ?? "—"}</td>
                      <td className="py-1 pr-2">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mb-0 mt-2 text-[11px] text-[var(--faint)]">
              Open-Meteo Marine は参考情報です。施工判定の入力には使用しません。
            </p>
          </div>
        </div>
      ) : null}

      {tab === "decision" ? (
        <div className="dc-card flex max-w-2xl flex-col gap-3 px-[18px] py-[17px]">
          <h2 className="m-0 text-sm font-semibold">🧭 施工可否判定 (go / caution / stop)</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11.5px] text-[var(--muted)]">
              作業種別
              <select value={workType} onChange={(e) => setWorkType(e.target.value)} className="dc-input text-xs">
                {WORK_TYPES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] text-[var(--muted)]">
              施工開始
              <input type="datetime-local" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className="dc-input text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] text-[var(--muted)]">
              施工終了
              <input type="datetime-local" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className="dc-input text-xs" />
            </label>
            <button type="button" className="dc-btn-accent" onClick={() => void runDecision()} disabled={loading || !siteId}>
              {loading ? "⏳ 判定中..." : "🧭 判定実行"}
            </button>
          </div>
          {decision !== null ? (
            <div className={`rounded-lg border p-3 ${decision.status === "stop" ? "border-[var(--red)] bg-[var(--red-bg)]" : decision.status === "caution" ? "border-[var(--amber)] bg-[var(--amber-bg)]" : "border-[var(--green)] bg-[var(--green-bg)]"}`}>
              <div className="text-lg font-bold">
                {decision.status === "go" ? "✅ 施工可" : decision.status === "caution" ? "⚠️ 警戒" : "🛑 中止推奨"}
              </div>
              <pre className="m-0 mt-2 whitespace-pre-wrap text-[12px]">{decision.reason}</pre>
              <p className="mb-0 mt-2 text-[11px] text-[var(--faint)]">
                ⚠️ 本判定は確認支援です。施工可否・安全性・法令適合を断定しません。最終判断は担当者が行ってください。
              </p>
            </div>
          ) : (
            <p className="m-0 text-[11.5px] text-[var(--muted)]">
              判定には最新観測と閾値が必要です。欠測がある場合は施工可と判定しません (fail-closed)。
            </p>
          )}
        </div>
      ) : null}

      {tab === "sites" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="dc-card px-[18px] py-[17px]">
            <h2 className="mb-2 mt-0 text-sm font-semibold">🚧 現場一覧</h2>
            <ul className="m-0 max-h-80 list-none overflow-auto p-0">
              {sites.map((site) => (
                <li key={site.id} className="mb-1 flex items-center gap-2 border-b border-[var(--line)] pb-1 text-[12.5px] last:border-0">
                  <span className="font-medium">{site.code}</span>
                  <span>{site.name}</span>
                  <span className="ml-auto text-[10.5px] text-[var(--faint)]">
                    {site.kind} / {site.lat.toFixed(4)}, {site.lon.toFixed(4)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="dc-card px-[18px] py-[17px]">
            <h2 className="mb-2 mt-0 text-sm font-semibold">現場登録 (管理認証必須)</h2>
            <form className="grid grid-cols-2 gap-2" onSubmit={createSite}>
              <input name="code" required placeholder="コード (例: TYO-07)" className="dc-input text-xs" aria-label="コード" />
              <input name="name" required placeholder="現場名" className="dc-input text-xs" aria-label="現場名" />
              <select name="kind" className="dc-input text-xs" aria-label="種別">
                <option value="land">陸上 (land)</option>
                <option value="marine">海上 (marine)</option>
                <option value="both">両方 (both)</option>
              </select>
              <input name="jmaStationId" placeholder="AMeDAS局番 (任意)" className="dc-input text-xs" aria-label="AMeDAS局番" />
              <input name="lat" required type="number" step="any" placeholder="緯度" className="dc-input text-xs" aria-label="緯度" />
              <input name="lon" required type="number" step="any" placeholder="経度" className="dc-input text-xs" aria-label="経度" />
              <input name="address" placeholder="住所 (任意)" className="dc-input col-span-2 text-xs" aria-label="住所" />
              <button type="submit" className="dc-btn-accent col-span-2">
                登録
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {tab === "reports" ? (
        <div className="dc-card max-w-xl px-[18px] py-[17px]">
          <h2 className="mb-2 mt-0 text-sm font-semibold">📊 レポート出力 (管理認証必須)</h2>
          <form className="grid grid-cols-2 gap-2" onSubmit={downloadReport}>
            <select name="template" className="dc-input text-xs" aria-label="テンプレート">
              <option value="daily">日次 (daily)</option>
              <option value="weekly">週次 (weekly)</option>
              <option value="monthly">月次 (monthly)</option>
              <option value="marine">海象 (marine)</option>
              <option value="decision">判定履歴 (decision)</option>
              <option value="annual">年次 (annual)</option>
            </select>
            <select name="format" className="dc-input text-xs" aria-label="形式">
              <option value="csv">CSV</option>
              <option value="markdown">Markdown</option>
            </select>
            <input name="dateFrom" required type="date" className="dc-input text-xs" aria-label="開始日" />
            <input name="dateTo" required type="date" className="dc-input text-xs" aria-label="終了日" />
            <button type="submit" className="dc-btn-accent col-span-2">
              ⬇️ 生成・ダウンロード
            </button>
          </form>
        </div>
      ) : null}

      {tab === "etl" ? (
        <div className="dc-card max-w-2xl px-[18px] py-[17px]">
          <h2 className="mb-2 mt-0 text-sm font-semibold">⚙️ データ取得状況</h2>
          <ul className="m-0 list-none p-0">
            {(etl?.jobs ?? []).map((job) => (
              <li key={job.id} className="mb-2 flex items-center gap-2 border-b border-[var(--line)] pb-2 text-[12.5px] last:border-0">
                <span>{job.name}</span>
                <span className="ml-auto text-[11px] text-[var(--muted)]">
                  {job.records} 件 / 最終観測 {job.lastObservedAt ? new Date(job.lastObservedAt).toLocaleString("ja-JP") : "なし"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[10.5px] font-semibold ${
                    job.status === "ok" ? "bg-[var(--green-bg)] text-[var(--green)]" : job.status === "stale" ? "bg-[var(--amber-bg)] text-[var(--amber)]" : "bg-[var(--subtle)] text-[var(--muted)]"
                  }`}
                >
                  {job.status === "ok" ? "正常" : job.status === "stale" ? "停滞" : "不明"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mb-0 mt-2 text-[11px] text-[var(--faint)]">
            AMeDAS: 10分毎 / Open-Meteo Marine: 10分毎 (参考情報)。取り込みは GitHub Actions の定期ワークフローが実行します。
          </p>
        </div>
      ) : null}

      {message !== "" ? <p className="m-0 text-[11.5px] text-[var(--amber)]" role="status">{message}</p> : null}
    </div>
  );
}

function MetricCard({ label, value, unit }: { label: string; value: number | null | undefined; unit: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] p-3">
      <div className="text-[11px] text-[var(--muted)]">{label}</div>
      <div className="text-xl font-semibold">
        {value === null || value === undefined ? "—" : value.toFixed(1)}
        <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">{unit}</span>
      </div>
    </div>
  );
}

function buildWindRose(rows: WeatherRow[]): { dir: string; ratio: number }[] {
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const counts = new Array<number>(8).fill(0);
  let total = 0;
  for (const row of rows) {
    if (row.windDirDeg === null || row.windSpeedMs === null) continue;
    const index = Math.round(((row.windDirDeg % 360) + 360) % 360 / 45) % 8;
    counts[index] += 1;
    total += 1;
  }
  return dirs.map((dir, i) => ({ dir, ratio: total > 0 ? counts[i] / total : 0 }));
}

function WindRose({ data }: { data: { dir: string; ratio: number }[] }) {
  return (
    <div className="flex h-28 items-end gap-1">
      {data.map((item) => (
        <div key={item.dir} className="flex flex-1 flex-col items-center gap-1">
          <div className="w-full rounded-t bg-[var(--blue)]" style={{ height: `${Math.max(item.ratio * 100, item.ratio > 0 ? 4 : 1)}%` }} title={`${item.dir} ${(item.ratio * 100).toFixed(1)}%`} />
          <span className="text-[9.5px] text-[var(--muted)]">{item.dir}</span>
        </div>
      ))}
    </div>
  );
}

function defaultWindowStart(): string {
  const d = new Date(Date.now() + 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
}

function defaultWindowEnd(): string {
  const d = new Date(Date.now() + 4 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
