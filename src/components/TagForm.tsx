"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TagForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "タグの追加に失敗しました");
        return;
      }
      setName("");
      router.refresh();
    } catch {
      setError("タグの追加に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="tag-name" className="mb-1 block text-xs font-medium text-slate-600">🏷️ タグ名</label>
        <input
          id="tag-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">色</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-14 rounded border border-slate-300"
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "⏳" : "➕ 追加"}
      </button>
      {error && <p className="text-sm text-red-600">⚠️ {error}</p>}
    </form>
  );
}
