import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { FetchLogTable } from "@/components/FetchLogTable";
import { LogsFilterSelect } from "@/components/LogsFilterSelect";

export const metadata = {
  title: "取得ログ",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ success?: string | string[] }>;

export default async function LogsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // 重複クエリ (string[]) や不正値は「すべて」扱いに正規化し、
  // 絞り込み条件とセレクト表示へ同一値を渡す
  const successFilter = sp.success === "true" || sp.success === "false" ? sp.success : "";
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
      ...(successFilter === "true" ? { success: true } : {}),
      ...(successFilter === "false" ? { success: false } : {}),
    },
    include: { dataSource: { select: { id: true, name: true } } },
    orderBy: { executedAt: "desc" },
    take: 1000,
  });

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[1.4rem] font-semibold">🧾 取得ログ一覧</h1>
        <LogsFilterSelect value={successFilter} />
      </div>
      <div className="dc-card px-[18px] py-[17px]">
        <p className="mb-2.5 text-[11.5px] text-[var(--muted)]">📊 直近 {logs.length} 件を表示</p>
        <FetchLogTable logs={logs} />
      </div>
    </div>
  );
}
