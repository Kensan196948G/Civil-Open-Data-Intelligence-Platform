import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { AUDIT_LEVELS, isAuditLevel } from "@/lib/audit";
import { AuditLogPanel } from "@/components/AuditLogPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "監査ログ",
};

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export default async function AuditPage() {
  const canView = isAdminHeaders(await headers());

  if (!canView) {
    return (
      <div className="flex flex-col gap-3.5">
        <h1 className="m-0 text-[1.4rem] font-semibold">🔍 監査ログ</h1>
        <section className="rounded-[var(--radius)] border border-[var(--amber)] bg-[var(--amber-bg)] p-4 text-sm text-[var(--amber)]">
          監査ログは運用情報を含むため管理者のみ表示します。
          本番・共有プレビューでは Cloudflare Access の管理者allowlist、または管理APIトークン運用を設定してください。
        </section>
      </div>
    );
  }

  // 操作・イベントの証跡 (audit_logs)。取得ログ由来の過去イベントは
  // migration で backfill 済みのため、この1テーブルが監査証跡の正本となる
  const events = await prisma.auditLog.findMany({
    orderBy: { occurredAt: "desc" },
    take: 500,
  });
  const exportRows = events.map((e) => [
    fmtDateTime(e.occurredAt),
    e.actor,
    e.action,
    e.target,
    e.detail,
    (isAuditLevel(e.level) ? AUDIT_LEVELS[e.level] : AUDIT_LEVELS.info).label,
  ]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h1 className="m-0 text-[1.4rem] font-semibold">🔍 監査ログ</h1>
        <AuditLogPanel rows={exportRows} />
      </div>

      <div className="dc-card overflow-x-auto px-[18px] py-[17px]">
        <p className="mb-2.5 text-[11.5px] text-[var(--muted)]">📊 {events.length} 件の操作履歴</p>
        {events.length === 0 ? (
          <p className="py-4 text-sm text-[var(--muted)]">🔍 監査対象の操作履歴はまだありません。</p>
        ) : (
          <table className="min-w-full border-collapse text-[12.5px]">
            <caption className="sr-only">監査ログ一覧</caption>
            <thead>
              <tr>
                <th scope="col" className="dc-th">日時</th>
                <th scope="col" className="dc-th">実行者</th>
                <th scope="col" className="dc-th">操作</th>
                <th scope="col" className="dc-th">対象</th>
                <th scope="col" className="dc-th">詳細</th>
                <th scope="col" className="dc-th">レベル</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const c = isAuditLevel(e.level) ? AUDIT_LEVELS[e.level] : AUDIT_LEVELS.info;
                return (
                  <tr key={e.id} className="hover:bg-[var(--hover)]">
                    <th scope="row" className="dc-td whitespace-nowrap text-left font-normal tabular-nums">
                      {fmtDateTime(e.occurredAt)}
                    </th>
                    <td className="dc-td">{e.actor}</td>
                    <td className="dc-td">{e.action}</td>
                    <td className="dc-td">{e.target}</td>
                    <td className="dc-td text-[var(--ink-2)]">{e.detail}</td>
                    <td className="dc-td">
                      <span className="dc-badge" style={{ color: c.fg, background: c.bg }}>
                        {c.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
