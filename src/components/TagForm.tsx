"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminHeaders } from "@/lib/admin-client";

// デザイン正本 (docs/design) の PALETTE と同一。クリックで 1 色を選択する 8 色スウォッチ。
const PALETTE = [
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#4b5563",
];

const DEFAULT_COLOR = "#2563eb";

export function TagForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [color, setColor] = useState(DEFAULT_COLOR);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: formData.get("name"),
          color,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? data?.details?.fieldErrors?.name?.[0] ?? "タグを追加できませんでした");
        return;
      }
      form.reset();
      setColor(DEFAULT_COLOR);
      router.refresh();
    } catch {
      setError("タグを追加できませんでした");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tag-name" className="dc-label mb-0">
          🏷️ タグ名
        </label>
        <input id="tag-name" name="name" required className="dc-input w-[200px]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="tag-color-label" className="dc-label mb-0">
          色
        </span>
        <div className="flex gap-1.5" role="group" aria-labelledby="tag-color-label">
          {PALETTE.map((hex) => {
            const selected = hex === color;
            return (
              <button
                key={hex}
                type="button"
                aria-label={`色 ${hex}`}
                aria-pressed={selected}
                onClick={() => setColor(hex)}
                className="h-[22px] w-[22px] rounded-md"
                style={{
                  background: hex,
                  boxShadow: selected ? "0 0 0 2px #fff, 0 0 0 4px var(--ink-2)" : undefined,
                }}
              />
            );
          })}
        </div>
      </div>
      <button type="submit" disabled={pending} className="dc-btn-accent disabled:opacity-50">
        {pending ? "⏳ 追加中" : "➕ 追加"}
      </button>
      {error && (
        <p className="text-[12.5px] text-[var(--red)]" role="alert">
          ⚠️ {error}
        </p>
      )}
    </form>
  );
}
