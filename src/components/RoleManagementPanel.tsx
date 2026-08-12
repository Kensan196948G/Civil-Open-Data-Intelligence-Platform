"use client";

import { useState } from "react";
import { notifyAuditEvent } from "@/lib/audit-events-client";

export type RoleAssignmentView = {
  id: string;
  userEmail: string;
  role: string;
  scope: string;
  expiresAt: string | null;
  createdAt: string;
};

type RoleManagementPanelProps = {
  roles: string[];
  initialAssignments: RoleAssignmentView[];
};

type ApiResponse<T> = { ok: boolean; data?: T; error?: { message: string } };

async function api<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: { message: body?.error?.message ?? `HTTP ${response.status}` } };
  }
  return { ok: true, data: body?.data as T };
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function RoleManagementPanel({
  roles,
  initialAssignments,
}: RoleManagementPanelProps) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0] ?? "engineer");
  const [scope, setScope] = useState("global");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    const result = await api<{ assignments: RoleAssignmentView[] }>("/api/admin/roles");
    if (result.ok && result.data) {
      setAssignments(result.data.assignments);
    }
  }

  async function assign() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !role) {
      setMessage({ ok: false, text: "メールアドレスとロールを入力してください" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, string> = {
        userEmail: trimmedEmail,
        role,
        scope: scope.trim() || "global",
      };
      if (expiresAt) payload.expiresAt = new Date(`${expiresAt}T00:00:00+09:00`).toISOString();
      const result = await api<{ assignment: { id: string } }>("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error?.message ?? "割当に失敗しました" });
        return;
      }
      notifyAuditEvent("role_assign", trimmedEmail);
      setEmail("");
      setExpiresAt("");
      setMessage({ ok: true, text: `✅ ${trimmedEmail} へ ${role} (${scope || "global"}) を割当しました` });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, userEmail: string) {
    setBusy(true);
    try {
      const result = await api<{ revoked: string }>(`/api/admin/roles/${id}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error?.message ?? "失効に失敗しました" });
        return;
      }
      notifyAuditEvent("role_revoke", userEmail);
      setMessage({ ok: true, text: `✅ ${userEmail} の割当を失効しました` });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dc-card px-[18px] py-[17px]">
      <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">👥 ロール管理</h2>
      <p className="mt-0 mb-2.5 text-[12.5px] text-[var(--ink-2)]">
        RBAC割当を管理します。変更は監査ログへ記録されます（docs/design/rbac-design.md）。
      </p>

      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-[5px]">
            <label htmlFor="role-user-email" className="text-xs font-semibold text-[var(--ink-2)]">
              メールアドレス
            </label>
            <input
              id="role-user-email"
              type="email"
              className="dc-input"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label htmlFor="role-name" className="text-xs font-semibold text-[var(--ink-2)]">
              ロール
            </label>
            <select id="role-name" className="dc-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-[5px]">
            <label htmlFor="role-scope" className="text-xs font-semibold text-[var(--ink-2)]">
              scope（global または site:&lt;id&gt;）
            </label>
            <input
              id="role-scope"
              className="dc-input"
              placeholder="global"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-[5px]">
            <label htmlFor="role-expires-at" className="text-xs font-semibold text-[var(--ink-2)]">
              期限（任意・YYYY-MM-DD）
            </label>
            <input
              id="role-expires-at"
              type="date"
              className="dc-input"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={assign}
            disabled={busy}
            className="dc-btn-accent"
          >
            {busy ? "⏳ 処理中..." : "➕ 割当"}
          </button>
        </div>

        {message && (
          <p role="status" className={`m-0 text-[12.5px] ${message.ok ? "text-[var(--green)]" : "text-[var(--amber)]"}`}>
            {message.text}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[var(--ink-2)]">
                <th className="border-b border-[var(--border)] py-1.5 pr-3 font-semibold">ユーザー</th>
                <th className="border-b border-[var(--border)] py-1.5 pr-3 font-semibold">ロール</th>
                <th className="border-b border-[var(--border)] py-1.5 pr-3 font-semibold">scope</th>
                <th className="border-b border-[var(--border)] py-1.5 pr-3 font-semibold">期限</th>
                <th className="border-b border-[var(--border)] py-1.5 pr-3 font-semibold">作成日時</th>
                <th className="border-b border-[var(--border)] py-1.5 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-[var(--ink-2)]">
                    割当はまだありません。既定は viewer です。
                  </td>
                </tr>
              ) : (
                assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="border-b border-[var(--border)] py-1.5 pr-3">{a.userEmail}</td>
                    <td className="border-b border-[var(--border)] py-1.5 pr-3">{a.role}</td>
                    <td className="border-b border-[var(--border)] py-1.5 pr-3">{a.scope}</td>
                    <td className="border-b border-[var(--border)] py-1.5 pr-3">
                      {a.expiresAt ? fmtDateTime(a.expiresAt) : "なし"}
                    </td>
                    <td className="border-b border-[var(--border)] py-1.5 pr-3">{fmtDateTime(a.createdAt)}</td>
                    <td className="border-b border-[var(--border)] py-1.5">
                      <button
                        type="button"
                        onClick={() => revoke(a.id, a.userEmail)}
                        disabled={busy}
                        className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-semibold text-[var(--red)] disabled:opacity-60"
                      >
                        失効
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
