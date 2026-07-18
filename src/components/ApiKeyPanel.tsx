"use client";

import { useState } from "react";

// デザイン正本 (settings view: 3964-4131 行 / script: 4698-4719 行) の
// 「🔑 APIキーの設定」パネル。値はブラウザ内メモリにのみ保持し、
// localStorage への保存・外部送信は行わない (docs/09 のトークン非永続方針と整合)。

export type ApiKeySourceOption = { id: string; label: string };

type TestResult = { ok: boolean; msg: string };
type SavedEntry = { maskedValue: string; savedAt: string };

// デザイン正本 maskKey と同一: 4文字以下は全マスク、それ以外は先頭2+末尾2のみ表示
function maskKey(v: string): string {
  if (v.length <= 4) return "*".repeat(v.length);
  return v.slice(0, 2) + "*".repeat(Math.max(0, v.length - 4)) + v.slice(-2);
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function ApiKeyPanel({ sources }: { sources: ApiKeySourceOption[] }) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [saved, setSaved] = useState<Record<string, SavedEntry>>({});

  const savedEntry = saved[sourceId];

  function testApiKey() {
    const val = value.trim();
    if (!val) {
      setResult({ ok: false, msg: "⚠️ APIキーを入力してください" });
      return;
    }
    setTesting(true);
    // デザイン正本と同じ形式チェック (6文字以上)。疎通確認は保存後にデータソース詳細から行う
    setTimeout(() => {
      const ok = val.length >= 6;
      setTesting(false);
      setResult({
        ok,
        msg: ok
          ? "✅ 有効な形式です(実際の疎通確認は保存後にデータソース詳細から実行してください)"
          : "❌ 形式が正しくない可能性があります(6文字以上を推奨)",
      });
    }, 600);
  }

  function saveApiKey() {
    const val = value.trim();
    if (!val) return;
    setSaved((s) => ({
      ...s,
      [sourceId]: { maskedValue: maskKey(val), savedAt: new Date().toISOString() },
    }));
    setResult({ ok: true, msg: "✅ 保存しました(値はブラウザ内のみに保持され、送信されません)" });
  }

  function clearInput() {
    setValue("");
    setResult(null);
  }

  return (
    <div className="dc-card px-[18px] py-[17px]">
      <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">🔑 APIキーの設定</h2>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-[5px]">
          <label htmlFor="api-key-source" className="text-xs font-semibold text-[var(--ink-2)]">
            対象データソース
          </label>
          <select
            id="api-key-source"
            className="dc-input"
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              setResult(null);
            }}
          >
            {sources.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-[5px]">
          <label htmlFor="api-key-value" className="text-xs font-semibold text-[var(--ink-2)]">
            APIキー
          </label>
          <input
            id="api-key-value"
            type="password"
            placeholder="APIキーを入力"
            className="dc-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={testApiKey}
            disabled={testing}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--blue)] bg-[var(--blue)] px-3.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
          >
            {testing ? "⏳ テスト中..." : "🧪 テスト"}
          </button>
          <button type="button" onClick={saveApiKey} className="dc-btn-accent">
            💾 保存
          </button>
          <button type="button" onClick={clearInput} className="dc-btn-ghost">
            入力クリア
          </button>
        </div>
        {result && (
          <p
            role="status"
            className="m-0 text-[12.5px]"
            style={{ color: result.ok ? "var(--green)" : "var(--red)" }}
          >
            {result.msg}
          </p>
        )}
        {savedEntry && (
          <p className="m-0 text-[11.5px] text-[var(--muted)]">
            🔒 保存済み:{" "}
            <span style={{ fontFamily: "var(--mono)" }}>{savedEntry.maskedValue}</span>（
            {fmtDateTime(savedEntry.savedAt)}）
          </p>
        )}
      </div>
      <p className="mb-0 mt-3 rounded-lg bg-[var(--red-bg)] px-3 py-[9px] text-[11.5px] text-[var(--red)]">
        🚫 APIキーの値はブラウザ内にのみ保持され、外部へ送信されません。本番運用では{" "}
        <code>.env</code> に保存し、GitHub へは絶対にコミットしないでください。
      </p>
    </div>
  );
}
