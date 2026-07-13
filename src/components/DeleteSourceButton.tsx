"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminHeaders } from "@/lib/admin-client";

export function DeleteSourceButton({ sourceId, name }: { sourceId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(`「${name}」を削除しますか？関連する取得ログ・サンプルも削除されます。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE", headers: adminHeaders() });
      if (res.ok) {
        router.push("/sources");
        router.refresh();
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.message ?? "削除に失敗しました");
    } catch {
      setError("削除に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={handleDelete}
        disabled={busy}
        className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {busy ? "⏳ 削除中" : "🗑️ 削除"}
      </button>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}
