import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { STALE_CHECK_DAYS, categoryLabel } from "@/lib/constants";
import { safeFetchLogDto } from "@/lib/operational-dto";
import { SummaryCard } from "@/components/SummaryCard";
import { FetchLogTable } from "@/components/FetchLogTable";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata = {
  // 注意: title.template はそれを定義したセグメントの「子」にのみ適用されるため、
  // root layout と同一セグメントの本ページはフル表記が必要
  title: "ダッシュボード | Civil Open Data Intelligence Platform",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const canManage = isAdminHeaders(await headers());
  const staleBefore = new Date(Date.now() - STALE_CHECK_DAYS * 24 * 60 * 60 * 1000);

  const [total, active, failed, needsReview, byCategory, recentSources] =
    await Promise.all([
      prisma.dataSource.count(),
      prisma.dataSource.count({ where: { status: "active" } }),
      prisma.dataSource.count({ where: { status: { in: ["unstable", "deprecated"] } } }),
      prisma.dataSource.count({
        where: {
          OR: [
            { status: "unknown" },
            { commercialUse: "unknown" },
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: staleBefore } },
          ],
        },
      }),
      prisma.dataSource.groupBy({ by: ["category"], _count: { _all: true } }),
      prisma.dataSource.findMany({
        include: { provider: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">🏠 ダッシュボード</h1>
        {canManage && (
          <Link
            href="/sources/new"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            ➕ データソース登録
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard icon="📚" label="登録データソース" value={total} />
        <SummaryCard icon="✅" label="接続成功" value={active} accent="text-green-600" />
        <SummaryCard icon="❌" label="接続失敗" value={failed} accent="text-red-600" />
        <SummaryCard icon="⚠️" label="要確認" value={needsReview} accent="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">🏷️ カテゴリ別件数</h2>
          <ul className="space-y-1 text-sm">
            {byCategory.map((c) => (
              <li key={c.category} className="flex justify-between border-b border-slate-100 py-1">
                <Link href={`/sources?category=${c.category}`} className="text-blue-600 hover:underline">
                  {categoryLabel(c.category)}
                </Link>
                <span className="font-medium">{c._count._all} 件</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">🆕 最近登録したデータソース</h2>
          <ul className="space-y-2 text-sm">
            {recentSources.map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div>
                  <Link href={`/sources/${s.id}`} className="font-medium text-blue-600 hover:underline">
                    {s.name}
                  </Link>
                  <span className="ml-2 text-xs text-slate-500">{s.provider.name}</span>
                </div>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">🧾 最近の取得ログ</h2>
          <Link href="/logs" className="text-xs text-blue-600 hover:underline">
            すべて見る →
          </Link>
        </div>
        {canManage ? (
          <FetchLogTable
            logs={(
              await prisma.fetchLog.findMany({
                include: { dataSource: { select: { id: true, name: true } } },
                orderBy: { executedAt: "desc" },
                take: 10,
              })
            ).map((log) => safeFetchLogDto(log))}
          />
        ) : (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
            取得ログは運用情報を含むため管理者のみ表示します。
          </p>
        )}
      </section>
    </div>
  );
}
