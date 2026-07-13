"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminHeaders } from "@/lib/admin-client";

export function TagForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
          color: formData.get("color"),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? data?.details?.fieldErrors?.name?.[0] ?? "タグを追加できませんでした");
        return;
      }
      form.reset();
      router.refresh();
    } catch {
      setError("タグを追加できませんでした");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="tag-name" className="mb-1 block text-xs font-medium text-slate-600">
          🏷️ タグ名
        </label>
        <input
          id="tag-name"
          name="name"
          required
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor="tag-color" className="mb-1 block text-xs font-medium text-slate-600">
          色
        </label>
        <input
          id="tag-color"
          name="color"
          type="color"
          defaultValue="#2563eb"
          className="h-9 w-14 rounded border border-slate-300"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "⏳ 追加中" : "➕ 追加"}
      </button>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          ⚠️ {error}
        </p>
      )}
    </form>
  );
}
