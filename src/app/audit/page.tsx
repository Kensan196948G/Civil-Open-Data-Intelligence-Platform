import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { ERROR_TYPE_MESSAGES } from "@/lib/constants";
import { AuditLogPanel } from "@/components/AuditLogPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "監査ログ",
};

// デザイン正本 (AUDIT_LEVELS) と同一の配色・ラベル
const AUDIT_LEVELS = {
  info: { fg: "var(--blue)", bg: "var(--blue-bg)", label: "情報" },
  success: { fg: "var(--green)", bg: "var(--green-bg)", label: "成功" },
  warning: { fg: "var(--amber)", bg: "var(--amber-bg)", label: "警告" },
  danger: { fg: "var(--red)", bg: "var(--red-bg)", label: "危険" },
} as const;

type AuditLevel = keyof typeof AUDIT_LEVELS;

type AuditEvent = {
  id: string;
  occurredAt: Date;
  actor: string;
  action: string;
  target: string;
  detail: string;
  level: AuditLevel;
};

type SourceLog = {
  id: string;
  executedAt: Date;
  executionType: string;
  success: boolean;
  errorType: string | null;
  dataSource?: { name: string } | null;
};

// 取得ログ (接続確認 / サンプル取得) を監査イベント形式へ写像する。
// 操作系イベント (登録・更新・削除・設定変更) は AuditLog モデル導入後に拡張予定。
function toAuditEvent(log: SourceLog): AuditEvent {
  const target = log.dataSource?.name ?? "-";
  const errorDetail = log.errorType
    ? (ERROR_TYPE_MESSAGES[log.errorType] ?? log.errorType)
    : "詳細不明のエラー";

  if (log.executionType === "sample") {
    return {
      id: log.id,
      occurredAt: log.executedAt,
      actor: "システム",
      action: "サンプル取得実行",
      target,
      detail: log.success ? "サンプルデータを取得" : errorDetail,
      level: log.success ? "success" : "danger",
    };
  }

  return {
    id: log.id,
    occurredAt: log.executedAt,
    actor: "システム",
    action: log.success ? "接続確認実行" : "接続失敗検知",
    target,
    detail: log.success ? "疎通確認 成功" : errorDetail,
    level: log.success ? "success" : "danger",
  };
}

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

  const logs = await prisma.fetchLog.findMany({
    include: { dataSource: { select: { name: true } } },
    orderBy: { executedAt: "desc" },
    take: 500,
  });
  const events = logs.map(toAuditEvent);
  const exportRows = events.map((e) => [
    fmtDateTime(e.occurredAt),
    e.actor,
    e.action,
    e.target,
    e.detail,
    AUDIT_LEVELS[e.level].label,
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
                const c = AUDIT_LEVELS[e.level];
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

      <p className="text-[11.5px] leading-relaxed text-[var(--muted)]">
        ℹ️ 現在は取得ログ（接続確認・サンプル取得）から生成した証跡を表示しています。
        操作系イベント（登録・更新・削除・設定変更）の証跡は AuditLog モデル導入後に拡張予定です。
      </p>
    </div>
  );
}
