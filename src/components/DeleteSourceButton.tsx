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
      {/* デザイン正本 (1441-1459 行): 赤アウトラインの削除ボタン */}
      <button
        onClick={handleDelete}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--red-2)] bg-white px-[14px] py-2 text-[12.5px] font-semibold text-[var(--red)] hover:bg-[var(--red-bg)] disabled:opacity-50"
      >
        {busy ? "⏳ 削除中" : "🗑️ 削除"}
      </button>
      {error && (
        <p className="text-[11px] text-[var(--red)]" role="alert">
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}
