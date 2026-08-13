"use client";

import { useCallback, useEffect, useState } from "react";

export type WatchTargetType = "site" | "dataSource" | "ingestionJob";

type WatchlistEntry = {
  id: string;
  targetType: string;
  targetId: string;
  enabled: boolean;
};

/**
 * ウォッチリスト登録の状態表示と切替。
 *
 * - 未登録: 「➕ ウォッチ」→ POST /api/v1/watchlist
 * - 有効:   「🔔 ウォッチ中」→ DELETE /api/v1/watchlist/{id}
 * - 無効:   「🔕 一時停止」→ PATCH /api/v1/watchlist/{id} で再有効化
 *
 * 個人単位の機能のため、管理セッション + 識別子（Access またはデモ識別子）が
 * 無い場合は 401 を「🔒 要ログイン」として表示する。
 */
export function WatchToggle({
  targetType,
  targetId,
}: {
  targetType: WatchTargetType;
  targetId: string;
}) {
  const [entry, setEntry] = useState<WatchlistEntry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/watchlist", { cache: "no-store" });
      if (res.status === 401) {
        setNeedsLogin(true);
        setEntry(null);
        return;
      }
      const body = await res.json().catch(() => null);
      const entries: WatchlistEntry[] = body?.data?.entries ?? [];
      setEntry(entries.find((item) => item.targetType === targetType && item.targetId === targetId) ?? null);
      setNeedsLogin(false);
    } catch {
      setError("ウォッチリストの取得に失敗しました");
    } finally {
      setLoaded(true);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (entry) {
        if (entry.enabled) {
          const res = await fetch(`/api/v1/watchlist/${entry.id}`, { method: "DELETE" });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error?.message ?? "ウォッチ解除に失敗しました");
          }
          setEntry(null);
        } else {
          const res = await fetch(`/api/v1/watchlist/${entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error?.message ?? "ウォッチ再開に失敗しました");
          }
          const body = await res.json();
          setEntry(body?.data?.entry ?? null);
        }
      } else {
        const res = await fetch("/api/v1/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (res.status === 401) {
            setNeedsLogin(true);
            throw new Error(body?.error?.message ?? "管理認証が必要です");
          }
          throw new Error(body?.error?.message ?? "ウォッチ登録に失敗しました");
        }
        const body = await res.json();
        setEntry(body?.data?.entry ?? null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ウォッチリストの操作に失敗しました");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return <span className="text-[11px] text-[var(--muted)]" aria-label="ウォッチリスト読込中">⏳</span>;
  }
  if (needsLogin) {
    return (
      <span
        className="text-[11px] text-[var(--muted)]"
        title="管理セッションと識別子（Access またはデモ識別子）が必要です"
      >
        🔒 要ログイン
      </span>
    );
  }

  const label = entry ? (entry.enabled ? "🔔 ウォッチ中" : "🔕 一時停止") : "➕ ウォッチ";
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={Boolean(entry?.enabled)}
        title={entry ? (entry.enabled ? "ウォッチリストから解除" : "ウォッチを再開") : "ウォッチリストへ登録"}
        className={`inline-flex items-center rounded-md border px-[7px] py-[2px] text-[11px] leading-[1.35] transition-colors disabled:opacity-50 ${
          entry?.enabled
            ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]"
            : "border-[var(--line)] bg-white text-[var(--ink-2)] hover:border-[var(--accent)]"
        }`}
      >
        {busy ? "⏳" : label}
      </button>
      {error && (
        <span className="text-[10.5px] text-[var(--red)]" role="alert">
          ⚠️ {error}
        </span>
      )}
    </span>
  );
}
