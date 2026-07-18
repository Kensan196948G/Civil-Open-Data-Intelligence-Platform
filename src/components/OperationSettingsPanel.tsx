"use client";

import { useState } from "react";

// デザイン正本 (settings view: 🔧 接続確認の動作設定) のセレクト群。
// 変更は PUT /api/admin/settings で永続化され、サーバー側で
// 監査ログ (設定変更) として記録される。
export type OperationSettingRow = {
  key: string;
  label: string; // アイコン付き表示ラベル (例: "⏱ タイムアウト")
  unit: string;
  options: number[];
  value: number;
};

type Feedback = { ok: boolean; msg: string };

export function OperationSettingsPanel({
  rows,
  canEdit,
}: {
  rows: OperationSettingRow[];
  canEdit: boolean;
}) {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.key, r.value])),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function changeSetting(row: OperationSettingRow, nextValue: number) {
    const previous = values[row.key];
    if (previous === nextValue) return;
    setValues((v) => ({ ...v, [row.key]: nextValue }));
    setBusyKey(row.key);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: row.key, value: nextValue }),
      });
      if (res.ok) {
        setFeedback({ ok: true, msg: `✅ ${row.label.replace(/^\S+\s/, "")}を ${nextValue} ${row.unit}に変更しました` });
      } else {
        const data = await res.json().catch(() => null);
        setValues((v) => ({ ...v, [row.key]: previous }));
        setFeedback({
          ok: false,
          msg: `⚠️ 保存できませんでした: ${data?.message ?? `HTTP ${res.status}`}`,
        });
      }
    } catch {
      setValues((v) => ({ ...v, [row.key]: previous }));
      setFeedback({ ok: false, msg: "⚠️ 保存できませんでした: ネットワークエラー" });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="dc-card px-[18px] py-[17px]">
      <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">🔧 接続確認の動作設定</h2>
      <div className="flex flex-col gap-[11px]">
        {rows.map((row) => {
          const id = `setting-${row.key}`;
          return (
            <div key={row.key} className="flex items-center justify-between gap-3">
              <label htmlFor={id} className="text-[13px] text-[var(--ink-2)]">
                {row.label}
              </label>
              <select
                id={id}
                className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-[7px] text-[13px] text-[var(--ink)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
                value={values[row.key]}
                disabled={!canEdit || busyKey === row.key}
                onChange={(e) => changeSetting(row, Number(e.target.value))}
              >
                {row.options.map((o) => (
                  <option key={o} value={o}>
                    {o} {row.unit}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {feedback && (
        <p
          role="status"
          className="mb-0 mt-3 text-[12.5px]"
          style={{ color: feedback.ok ? "var(--green)" : "var(--red)" }}
        >
          {feedback.msg}
        </p>
      )}
      {!canEdit && (
        <p className="mb-0 mt-3 text-[11.5px] text-[var(--muted)]">
          🔒 変更には管理セッションが必要です。ページ下部の「🛡️ 管理操作トークン」から開始してください。
        </p>
      )}
    </div>
  );
}
