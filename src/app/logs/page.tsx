import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { FetchLogTable } from "@/components/FetchLogTable";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ success?: string }>;

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const canViewLogs = isAdminHeaders(await headers());

  if (!canViewLogs) {
    return (
      <div className="flex flex-col gap-3.5">
        <h1 className="m-0 text-[1.4rem] font-semibold">🧾 取得ログ一覧</h1>
        <section className="rounded-[var(--radius)] border border-[var(--amber)] bg-[var(--amber-bg)] p-4 text-sm text-[var(--amber)]">
          取得ログは接続先URL、エラー内容、運用状態を含むため管理者のみ表示します。
          本番・共有プレビューでは Cloudflare Access の管理者allowlist、または管理APIトークン運用を設定してください。
        </section>
      </div>
    );
  }

  const logs = await prisma.fetchLog.findMany({
    where: {
      ...(sp.success === "true" ? { success: true } : {}),
      ...(sp.success === "false" ? { success: false } : {}),
    },
    include: { dataSource: { select: { id: true, name: true } } },
    orderBy: { executedAt: "desc" },
    take: 1000,
  });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[1.4rem] font-semibold">🧾 取得ログ一覧</h1>
        <form method="GET" className="flex items-center gap-2">
          <label htmlFor="log-filter-success" className="text-xs font-semibold text-[var(--ink-2)]">
            表示条件
          </label>
          <select
            id="log-filter-success"
            name="success"
            defaultValue={sp.success ?? ""}
            className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          >
            <option value="">すべて</option>
            <option value="true">✅ 成功のみ</option>
            <option value="false">❌ 失敗のみ</option>
          </select>
          <button type="submit" className="dc-btn-accent">
            絞り込み
          </button>
        </form>
      </div>
      <div className="dc-card px-[18px] py-[17px]">
        <p className="mb-2.5 text-[11.5px] text-[var(--muted)]">
          📊 条件に一致する取得ログの直近 {logs.length} 件を表示（最大1000件）
        </p>
        <FetchLogTable logs={logs} />
      </div>
    </div>
  );
}
