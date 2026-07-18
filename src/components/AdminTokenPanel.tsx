"use client";

import { useEffect, useState } from "react";

export function AdminTokenPanel() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { authenticated?: boolean }) => setAuthenticated(Boolean(data.authenticated)))
      .catch(() => setAuthenticated(false));
  }, []);

  async function startSession() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.message ?? "管理セッションを開始できませんでした");
        setMessageTone("error");
        setAuthenticated(false);
        return;
      }
      setToken("");
      setAuthenticated(true);
      setMessage("管理セッションを開始しました");
      setMessageTone("success");
    } catch {
      setMessage("管理セッション開始中に通信エラーが発生しました");
      setMessageTone("error");
      setAuthenticated(false);
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/session", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data.message ?? "管理セッションを終了できませんでした");
        setMessageTone("error");
        return;
      }
      setAuthenticated(false);
      setToken("");
      setMessage("管理セッションを終了しました");
      setMessageTone("success");
    } catch {
      setMessage("管理セッション終了中に通信エラーが発生しました");
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">🛡️ 管理操作トークン</h2>
      <div className="flex flex-col gap-2 md:flex-row">
        <div className="flex-1">
          <label htmlFor="admin-token" className="mb-1 block text-xs font-medium text-slate-600">
            管理操作トークン
          </label>
          <input
            id="admin-token"
            type="password"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
            placeholder="CODIP_ADMIN_TOKEN と同じ値"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          onClick={startSession}
          disabled={busy || !token.trim()}
          className="whitespace-nowrap rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 md:self-end"
        >
          セッション開始
        </button>
        <button
          type="button"
          onClick={endSession}
          disabled={busy || !authenticated}
          className="whitespace-nowrap rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 md:self-end"
        >
          終了
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        本番環境で <code className="rounded bg-slate-100 px-1">CODIP_ADMIN_TOKEN</code>{" "}
        を設定した場合、ここで管理セッションを開始します。トークン値はブラウザに保存せず、HttpOnly Cookieの署名済みセッションだけを保持します。
      </p>
      <p className="mt-2 text-xs text-slate-600">
        状態: {authenticated ? "管理セッション有効" : "未認証"}
      </p>
      {message && (
        <p
          className={`mt-2 rounded px-2 py-1 text-xs ${
            messageTone === "success"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
          role={messageTone === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
