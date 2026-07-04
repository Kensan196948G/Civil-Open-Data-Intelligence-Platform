"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteSourceButton({ sourceId, name }: { sourceId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`「${name}」を削除しますか？関連する取得ログ・サンプルも削除されます。`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/sources");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "⏳" : "🗑️ 削除"}
    </button>
  );
}
