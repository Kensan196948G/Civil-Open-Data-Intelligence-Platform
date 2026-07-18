import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { STALE_CHECK_DAYS, categoryLabel } from "@/lib/constants";
import { safeFetchLogDto } from "@/lib/operational-dto";
import { SummaryCard } from "@/components/SummaryCard";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const ERROR_TYPE_MESSAGES: Record<string, string> = {
  timeout: "接続がタイムアウトしました",
  network: "ネットワーク接続に失敗しました",
  invalid_url: "URL形式が正しくありません",
  auth_required: "APIキーまたは認証が必要です",
  parse_error: "レスポンス形式を判定できませんでした",
  rate_limited: "アクセス制限の可能性があります",
  blocked_url: "取得が許可されていないURLです",
  unknown: "不明なエラーが発生しました",
};

function fmtBytes(n: number | null): string {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

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

  // デザイン正本のカテゴリ内訳: 最大件数を 100% とした横バー
  const maxCat = Math.max(1, ...byCategory.map((c) => c._count._all));
  const categoryBreakdown = byCategory
    .map((c) => ({
      value: c.category,
      label: categoryLabel(c.category),
      count: c._count._all,
      pct: Math.round((c._count._all / maxCat) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const recentLogs = canManage
    ? (
        await prisma.fetchLog.findMany({
          include: { dataSource: { select: { id: true, name: true } } },
          orderBy: { executedAt: "desc" },
          take: 8,
        })
      ).map((log) => safeFetchLogDto(log))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="m-0 text-[1.4rem] font-semibold">🏠 ダッシュボード</h1>
        {canManage && (
          <Link href="/sources/new" className="dc-btn-accent no-underline hover:no-underline">
            ➕ データソース登録
          </Link>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-[14px]">
        <SummaryCard label="登録データソース" value={total} dot="var(--blue-2)" sub="全カテゴリ合計" subColor="var(--muted)" />
        <SummaryCard label="接続成功" value={active} dot="var(--green-2)" sub={`${active} 件 稼働中`} subColor="var(--green)" />
        <SummaryCard label="接続失敗" value={failed} dot="var(--red-2)" sub="要対応" subColor="var(--red)" />
        <SummaryCard label="要確認" value={needsReview} dot="var(--amber)" sub="未確認・要確認" subColor="var(--amber)" />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section className="dc-card px-[18px] py-[17px]">
          <h2 className="mb-3 mt-0 text-sm font-semibold text-[var(--ink)]">🏷️ カテゴリ別件数</h2>
          <div className="flex flex-col gap-[10px]">
            {categoryBreakdown.map((c) => (
              <Link
                key={c.value}
                href={`/sources?category=${c.value}`}
                // E2E は getByRole("link", { name: "気象・防災" }) の完全一致で参照するため、
                // 件数まで含む内容から accessible name をラベルのみに固定する
                aria-label={c.label}
                className="block no-underline hover:no-underline"
              >
                <div className="mb-1 flex justify-between text-[12.5px]">
                  <span className="text-[var(--ink-2)]">{c.label}</span>
                  <span className="font-semibold text-[var(--ink)] tabular-nums" style={{ fontFamily: "var(--mono)" }}>
                    {c.count}件
                  </span>
                </div>
                <div className="h-[6px] overflow-hidden rounded-[3px] bg-[var(--line-2)]">
                  <div
                    className="h-full rounded-[3px] bg-[var(--blue-2)]"
                    style={{ width: `${c.pct}%` }}
                  ></div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="dc-card px-[18px] py-[17px]">
          <h2 className="mb-3 mt-0 text-sm font-semibold text-[var(--ink)]">🆕 最近登録したデータソース</h2>
          <div className="flex flex-col gap-[2px]">
            {recentSources.map((s) => (
              <Link
                key={s.id}
                href={`/sources/${s.id}`}
                className="flex items-center justify-between gap-2 border-b border-[var(--line-2)] py-2 no-underline hover:no-underline"
              >
                <div className="min-w-0">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-medium text-[var(--ink)]">
                    {s.name}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">{s.provider.name}</div>
                </div>
                <StatusBadge status={s.status} />
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="dc-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line-2)] px-[18px] py-[15px]">
          <h2 className="m-0 text-sm font-semibold text-[var(--ink)]">🧾 最近の取得ログ</h2>
          <Link href="/logs" className="text-xs">
            すべて見る →
          </Link>
        </div>
        {canManage ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["実行日時", "データソース", "種別", "結果", "応答"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-[var(--line-2)] bg-[var(--hover)] px-4 py-[11px] text-left text-[11px] font-semibold text-[var(--muted)]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--hover)]">
                    <td className="border-b border-[var(--line-2)] px-4 py-[9px] tabular-nums text-[var(--ink-2)]">
                      {new Date(log.executedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                    </td>
                    <td className="border-b border-[var(--line-2)] px-4 py-[9px]">
                      {log.dataSource ? (
                        <Link href={`/sources/${log.dataSource.id}`}>{log.dataSource.name}</Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="border-b border-[var(--line-2)] px-4 py-[9px] text-[var(--ink-2)]">
                      {log.executionType === "sample" ? "サンプル取得" : "接続確認"}
                    </td>
                    <td className="border-b border-[var(--line-2)] px-4 py-[9px]">
                      {log.success ? (
                        <span className="dc-badge" style={{ color: "var(--green)", background: "var(--green-bg)" }}>
                          ✅ 成功 {log.statusCode ?? ""}
                        </span>
                      ) : (
                        <span className="dc-badge" style={{ color: "var(--red)", background: "var(--red-bg)" }}>
                          ❌ {ERROR_TYPE_MESSAGES[log.errorType ?? "unknown"] ?? "失敗"}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-[var(--line-2)] px-4 py-[9px] tabular-nums text-[var(--ink-2)]">
                      {log.responseTimeMs != null ? `${log.responseTimeMs}ms` : "-"} /{" "}
                      {fmtBytes(log.responseSizeBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-4 rounded bg-[var(--amber-bg)] px-3 py-2 text-xs text-[var(--amber)]">
            取得ログは運用情報を含むため管理者のみ表示します。
          </p>
        )}
      </section>
    </div>
  );
}
