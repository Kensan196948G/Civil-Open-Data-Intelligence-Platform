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

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">🔌 接続確認・サンプル取得</h3>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("check")}
          disabled={busy !== null}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "check" ? "⏳ 確認中..." : "🔌 疎通確認"}
        </button>
        <button
          onClick={() => run("fetch-sample")}
          disabled={busy !== null}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "fetch-sample" ? "⏳ 取得中..." : "📦 サンプル取得"}
        </button>
        <button
          onClick={() => run("quality")}
          disabled={busy !== null}
          className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy === "quality" ? "⏳ 計算中..." : "⭐ 品質スコア再計算"}
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          ⚠️ {error}
        </p>
      )}
      {result && (
        <div
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            result.data.success
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
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
      <p className="mt-3 text-xs text-slate-600">
        ⏱ タイムアウト30秒 / リダイレクト最大3回 / 取得対象は登録済みURLのみ
      </p>
    </div>
  );
}
