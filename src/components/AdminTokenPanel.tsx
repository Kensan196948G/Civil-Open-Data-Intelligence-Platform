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
    <div className="dc-card px-[18px] py-[17px]">
      <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">🛡️ 管理操作トークン</h2>
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="flex-1">
          <label htmlFor="admin-token" className="dc-label">
            管理操作トークン
          </label>
          <input
            id="admin-token"
            type="password"
            className="dc-input"
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
          className="dc-btn-accent whitespace-nowrap disabled:opacity-50"
        >
          セッション開始
        </button>
        <button
          type="button"
          onClick={endSession}
          disabled={busy || !authenticated}
          className="dc-btn-ghost whitespace-nowrap disabled:opacity-50"
        >
          終了
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-[var(--muted)]">
        本番環境で{" "}
        <code className="rounded bg-[var(--subtle)] px-1 font-mono">CODIP_ADMIN_TOKEN</code>{" "}
        を設定した場合、ここで管理セッションを開始します。トークン値はブラウザに保存せず、HttpOnly Cookieの署名済みセッションだけを保持します。
      </p>
      <p className="mt-2 text-[11.5px] text-[var(--ink-2)]">
        状態: {authenticated ? "管理セッション有効" : "未認証"}
      </p>
      {message && (
        <p
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11.5px] ${
            messageTone === "success"
              ? "bg-[var(--green-bg)] text-[var(--green)]"
              : "bg-[var(--red-bg)] text-[var(--red)]"
          }`}
          role={messageTone === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
