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
      <div className="space-y-4">
        <h1 className="text-xl font-bold">🧾 取得ログ一覧</h1>
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">🧾 取得ログ一覧</h1>
        <form method="GET" className="flex items-center gap-2 text-sm">
          <label htmlFor="log-filter-success" className="text-xs text-slate-500">
            表示条件
          </label>
          <select
            id="log-filter-success"
            name="success"
            defaultValue={sp.success ?? ""}
            className="rounded border border-slate-300 px-2 py-1.5"
          >
            <option value="">すべて</option>
            <option value="true">✅ 成功のみ</option>
            <option value="false">❌ 失敗のみ</option>
          </select>
          <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-white hover:bg-slate-700">
            絞り込み
          </button>
        </form>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-2 text-xs text-slate-500">
          📊 条件に一致する取得ログの直近 {logs.length} 件を表示（最大1000件）
        </p>
        <FetchLogTable logs={logs} />
      </div>
    </div>
  );
}
