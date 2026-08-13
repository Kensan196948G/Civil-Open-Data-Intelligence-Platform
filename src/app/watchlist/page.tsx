"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminTokenPanel } from "@/components/AdminTokenPanel";
import type { WatchTargetType } from "@/components/WatchToggle";

type Entry = {
  id: string;
  targetType: WatchTargetType;
  targetId: string;
  enabled: boolean;
  createdAt: string;
};

type TargetOption = { id: string; label: string };

const TYPE_LABELS: Record<WatchTargetType, string> = {
  site: "🚧 現場",
  dataSource: "📚 データソース",
  ingestionJob: "⚙️ 収集ジョブ",
};

function targetLabel(entry: Entry, names: Record<WatchTargetType, Map<string, string>>): string {
  return names[entry.targetType].get(entry.targetId) ?? `ID: ${entry.targetId}`;
}

export default function WatchlistPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [identity, setIdentity] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"success" | "error">("success");
  const [options, setOptions] = useState<Record<WatchTargetType, TargetOption[]>>({
    site: [],
    dataSource: [],
    ingestionJob: [],
  });
  const [addType, setAddType] = useState<WatchTargetType>("site");
  const [addTargetId, setAddTargetId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/watchlist", { cache: "no-store" });
      if (res.status === 401) {
        setNeedsLogin(true);
        setEntries([]);
        setIdentity(null);
        return;
      }
      const body = await res.json();
      setNeedsLogin(false);
      setIdentity(body?.data?.identity ?? null);
      setEntries(body?.data?.entries ?? []);
    } catch {
      setMessage("ウォッチリストの取得に失敗しました");
      setTone("error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (needsLogin) return;
    async function loadOptions() {
      const next: Record<WatchTargetType, TargetOption[]> = { site: [], dataSource: [], ingestionJob: [] };
      try {
        const sitesRes = await fetch("/api/v1/sites");
        const sitesBody = await sitesRes.json().catch(() => null);
        next.site = (sitesBody?.data?.sites ?? []).map((site: { id: string; code: string; name: string }) => ({
          id: site.id,
          label: `${site.code} ${site.name}`,
        }));
      } catch {
        // 現場一覧は任意。取得できない場合は追加フォーム側で空表示にする
      }
      try {
        const sourcesRes = await fetch("/api/sources?limit=500");
        const sourcesBody = await sourcesRes.json().catch(() => null);
        next.dataSource = (sourcesBody?.items ?? []).map((source: { id: string; name: string }) => ({
          id: source.id,
          label: source.name,
        }));
      } catch {
        // 同上
      }
      try {
        const jobsRes = await fetch("/api/admin/ingestion/jobs");
        const jobsBody = await jobsRes.json().catch(() => null);
        next.ingestionJob = (jobsBody?.jobs ?? []).map((job: { id: string; name: string }) => ({
          id: job.id,
          label: job.name,
        }));
      } catch {
        // 同上
      }
      setOptions(next);
    }
    void loadOptions();
  }, [needsLogin]);

  const names = useMemo(() => {
    const result: Record<WatchTargetType, Map<string, string>> = {
      site: new Map(options.site.map((item) => [item.id, item.label])),
      dataSource: new Map(options.dataSource.map((item) => [item.id, item.label])),
      ingestionJob: new Map(options.ingestionJob.map((item) => [item.id, item.label])),
    };
    return result;
  }, [options]);

  async function addEntry() {
    if (!addTargetId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: addType, targetId: addTargetId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "登録に失敗しました");
      }
      setMessage("ウォッチリストへ登録しました");
      setTone("success");
      setAddTargetId("");
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "登録に失敗しました");
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/watchlist/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "解除に失敗しました");
      }
      setMessage("ウォッチリストから解除しました");
      setTone("success");
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "解除に失敗しました");
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(entry: Entry) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/watchlist/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !entry.enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "更新に失敗しました");
      }
      setMessage(entry.enabled ? "通知を一時停止しました" : "通知を再開しました");
      setTone("success");
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "更新に失敗しました");
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  if (needsLogin) {
    return (
      <div className="flex max-w-[720px] flex-col gap-[14px]">
        <div>
          <h1 className="m-0 text-[1.4rem] font-semibold">🔔 ウォッチリスト</h1>
          <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
            現場・データソース・収集ジョブの鮮度・障害をウォッチし、通知ダイジェストを受け取る個人向けの登録です。
          </p>
        </div>
        <div className="dc-card px-[18px] py-[17px]">
          <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">🔒 認証が必要</h2>
          <p className="mb-0 text-[13px] text-[var(--ink-2)]">
            ウォッチリストは個人単位のため、管理セッションとユーザー識別子（Cloudflare Access またはデモ識別子）が必要です。
            ページ下部の「🛡️ 管理操作トークン」からセッションを開始してください。
          </p>
        </div>
        <AdminTokenPanel />
      </div>
    );
  }

  const currentOptions = options[addType];

  return (
    <div className="flex max-w-[720px] flex-col gap-[14px]">
      <div>
        <h1 className="m-0 text-[1.4rem] font-semibold">🔔 ウォッチリスト</h1>
        <p className="mt-1.5 text-[12.5px] text-[var(--muted)]">
          現場・データソース・収集ジョブの鮮度・障害をウォッチします。日次の通知ダイジェストは
          enabled の登録のみ対象です。
          {identity && <span className="ml-1 text-[var(--faint)]">（識別子: {identity}）</span>}
        </p>
      </div>

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-3 mt-0 text-sm font-semibold text-[var(--ink)]">📋 登録一覧（{entries.length}件）</h2>
        {loading ? (
          <p className="mb-0 text-[12.5px] text-[var(--muted)]">⏳ 読み込み中...</p>
        ) : entries.length === 0 ? (
          <p className="mb-0 text-[12.5px] text-[var(--ink-2)]">登録はありません。下のフォームから追加できます。</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {entries.map((entry) => (
              <li key={entry.id} className="mb-2 flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-2 text-[12.5px] last:mb-0 last:border-0">
                <span className="text-[var(--muted)]">{TYPE_LABELS[entry.targetType]}</span>
                <span className="flex-1 break-all font-medium">{targetLabel(entry, names)}</span>
                <span className={entry.enabled ? "text-[var(--green)]" : "text-[var(--muted)]"}>
                  {entry.enabled ? "● 通知中" : "○ 一時停止"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleEnabled(entry)}
                  className="dc-btn-ghost"
                >
                  {entry.enabled ? "一時停止" : "再開"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeEntry(entry.id)}
                  className="dc-btn-ghost"
                >
                  解除
                </button>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p className={`mb-0 mt-2 text-[12px] ${tone === "error" ? "text-[var(--red)]" : "text-[var(--green)]"}`} role="alert">
            {tone === "error" ? "⚠️ " : "✅ "}
            {message}
          </p>
        )}
      </div>

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-3 mt-0 text-sm font-semibold text-[var(--ink)]">➕ 登録を追加</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="watch-type" className="dc-label">種別</label>
            <select
              id="watch-type"
              className="dc-input text-xs"
              value={addType}
              onChange={(event) => {
                setAddType(event.target.value as WatchTargetType);
                setAddTargetId("");
              }}
            >
              {(Object.keys(TYPE_LABELS) as WatchTargetType[]).map((type) => (
                <option key={type} value={type}>{TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="watch-target" className="dc-label">対象</label>
            <select
              id="watch-target"
              className="dc-input text-xs"
              value={addTargetId}
              onChange={(event) => setAddTargetId(event.target.value)}
            >
              <option value="">選択してください</option>
              {currentOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void addEntry()}
            disabled={busy || !addTargetId}
            className="dc-btn-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "⏳ 登録中" : "➕ 登録"}
          </button>
        </div>
      </div>
    </div>
  );
}
