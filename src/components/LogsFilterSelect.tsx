"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// デザイン正本 (logs view) と同じ「セレクト変更で即絞り込み」挙動。
// 選択値は URL クエリ (?success=true/false) に反映し、サーバー側で絞り込む。
export function LogsFilterSelect({ value }: { value: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="取得ログの表示条件"
      value={value}
      disabled={isPending}
      onChange={(e) => {
        const v = e.target.value;
        startTransition(() => {
          router.replace(v ? `/logs?success=${v}` : "/logs");
        });
      }}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-[11px] py-2 text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-60"
    >
      <option value="">すべて</option>
      <option value="true">✅ 成功のみ</option>
      <option value="false">❌ 失敗のみ</option>
    </select>
  );
}
