"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminHeaders } from "@/lib/admin-client";

type CheckResult = {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  contentType: string | null;
  responseSizeBytes: number | null;
  detectedFormat?: string | null;
  errorType: string | null;
  message: string | null;
};

export function CheckPanel({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: string; data: CheckResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "check" | "fetch-sample" | "quality") {
    setBusy(kind);
    setError(null);
    try {
      const url =
        kind === "quality"
          ? `/api/quality/${sourceId}/recalculate`
          : `/api/sources/${sourceId}/${kind}`;
      const res = await fetch(url, { method: "POST", headers: adminHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "実行に失敗しました");
        return;
      }
      setResult({ kind, data });
      router.refresh();
    } catch {
      setError("実行に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  // デザイン正本 (1463-1525 行): 疎通=blue / サンプル=green-2 / 品質=purple の実塗りボタン
  const btnBase =
    "inline-flex items-center gap-1.5 rounded-lg px-[14px] py-2 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50";

  return (
    <div className="dc-card px-[18px] py-[17px]">
      <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">🔌 接続確認・サンプル取得</h3>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("check")}
          disabled={busy !== null}
          className={`${btnBase} border border-[var(--blue)] bg-[var(--blue)]`}
        >
          {busy === "check" ? "⏳ 確認中..." : "🔌 疎通確認"}
        </button>
        <button
          onClick={() => run("fetch-sample")}
          disabled={busy !== null}
          className={`${btnBase} border border-[var(--green-2)] bg-[var(--green-2)]`}
        >
          {busy === "fetch-sample" ? "⏳ 取得中..." : "📦 サンプル取得"}
        </button>
        <button
          onClick={() => run("quality")}
          disabled={busy !== null}
          className={`${btnBase} border border-[var(--purple)] bg-[var(--purple)]`}
        >
          {busy === "quality" ? "⏳ 計算中..." : "⭐ 品質スコア再計算"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-[13px] text-[var(--red)]" role="alert">
          ⚠️ {error}
        </p>
      )}
      {result && (
        <div
          className={`mt-3 rounded-lg border px-[13px] py-2.5 text-[13px] ${
            result.data.success
              ? "border-[var(--green)] bg-[var(--green-bg)] text-[var(--green)]"
              : "border-[var(--red-2)] bg-[var(--red-bg)] text-[var(--red)]"
          }`}
          role="status"
        >
          <p>
            {result.data.success ? "✅ 成功" : "❌ 失敗"}
            {result.data.statusCode != null && ` / HTTP ${result.data.statusCode}`}
            {result.data.responseTimeMs != null && ` / ${result.data.responseTimeMs}ms`}
            {result.data.contentType && ` / ${result.data.contentType}`}
            {result.data.detectedFormat && ` / 形式: ${result.data.detectedFormat}`}
          </p>
          {result.data.message && <p className="mt-1 text-xs">{result.data.message}</p>}
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-[var(--faint)]">
        ⏱ タイムアウト30秒 / リダイレクト最大3回 / 取得対象は登録済みURLのみ
      </p>
    </div>
  );
}
