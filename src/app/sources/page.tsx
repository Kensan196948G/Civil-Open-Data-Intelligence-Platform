import Link from "next/link";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { CATEGORIES, DATA_FORMATS, SOURCE_STATUSES, categoryLabel } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { QualityScoreBadge, TrustLevelBadge } from "@/components/QualityScoreBadge";

export const metadata = {
  title: "データソース一覧",
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string;
  category?: string;
  providerId?: string;
  dataFormat?: string;
  requiresApiKey?: string;
  status?: string;
  tag?: string;
}>;

export default async function SourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const canManage = isAdminHeaders(await headers());
  const where: Prisma.DataSourceWhereInput = {};
  const q = sp.q?.trim();
  if (q && q.length >= 2) {
    where.OR = [
      { name: { contains: q } },
      { nameEn: { contains: q } },
      { description: { contains: q } },
    ];
  }
  if (sp.category) where.category = sp.category;
  if (sp.providerId) where.providerId = sp.providerId;
  if (sp.dataFormat) where.dataFormat = sp.dataFormat;
  if (sp.requiresApiKey === "true") where.requiresApiKey = true;
  if (sp.requiresApiKey === "false") where.requiresApiKey = false;
  if (sp.status) where.status = sp.status;
  if (sp.tag) where.tags = { some: { tagId: sp.tag } };

  const [sources, total, providers, tags] = await Promise.all([
    prisma.dataSource.findMany({
      where,
      include: { provider: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.dataSource.count({ where }),
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  // デザイン正本 (818-1364 行) のフィルタ入力: 13px / padding 8px 11px / border var(--line)
  const fieldCls =
    "rounded-lg border border-[var(--line)] bg-white px-[11px] py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <h1 className="text-[1.4rem] font-semibold">📚 データソース一覧</h1>
        {canManage && (
          <Link href="/sources/new" className="dc-btn-accent">
            ➕ 新規登録
          </Link>
        )}
      </div>

      <form
        method="GET"
        className="dc-card flex flex-wrap items-end gap-[10px] px-4 py-[14px]"
      >
        <div>
          <label htmlFor="source-filter-q" className="dc-label">🔍 キーワード</label>
          <input
            id="source-filter-q"
            name="q"
            defaultValue={sp.q ?? ""}
            className={`${fieldCls} w-[180px]`}
            placeholder="河川、道路、標高..."
          />
        </div>
        <div>
          <label htmlFor="source-filter-category" className="dc-label">カテゴリ</label>
          <select id="source-filter-category" name="category" defaultValue={sp.category ?? ""} className={fieldCls}>
            <option value="">すべて</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="source-filter-provider" className="dc-label">提供元</label>
          <select id="source-filter-provider" name="providerId" defaultValue={sp.providerId ?? ""} className={fieldCls}>
            <option value="">すべて</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="source-filter-format" className="dc-label">形式</label>
          <select id="source-filter-format" name="dataFormat" defaultValue={sp.dataFormat ?? ""} className={fieldCls}>
            <option value="">すべて</option>
            {DATA_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="source-filter-api-key" className="dc-label">🔑 APIキー</label>
          <select id="source-filter-api-key" name="requiresApiKey" defaultValue={sp.requiresApiKey ?? ""} className={fieldCls}>
            <option value="">すべて</option>
            <option value="true">必要</option>
            <option value="false">不要</option>
          </select>
        </div>
        <div>
          <label htmlFor="source-filter-status" className="dc-label">接続状態</label>
          <select id="source-filter-status" name="status" defaultValue={sp.status ?? ""} className={fieldCls}>
            <option value="">すべて</option>
            {SOURCE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="source-filter-tag" className="dc-label">🏷️ タグ</label>
          <select id="source-filter-tag" name="tag" defaultValue={sp.tag ?? ""} className={fieldCls}>
            <option value="">すべて</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="dc-btn-accent">
          🔍 検索
        </button>
        <Link href="/sources" className="px-1 py-2 text-[12.5px] text-[var(--muted)] hover:underline">
          クリア
        </Link>
      </form>

      <p className="text-[12.5px] text-[var(--muted)]">
        📊 条件一致 {total} 件中 {sources.length} 件を表示
        {total > sources.length && "（上位200件まで）"}
      </p>

      <div className="dc-card overflow-x-auto">
        <table aria-label="データソース検索結果一覧" className="w-full border-collapse text-[12.5px]">
          <caption className="sr-only">データソース検索結果一覧</caption>
          <thead>
            <tr>
              <th scope="col" className="dc-th">データソース名</th>
              <th scope="col" className="dc-th">提供元</th>
              <th scope="col" className="dc-th">カテゴリ</th>
              <th scope="col" className="dc-th">形式</th>
              <th scope="col" className="dc-th">🔑</th>
              <th scope="col" className="dc-th">接続状態</th>
              <th scope="col" className="dc-th">品質</th>
              <th scope="col" className="dc-th">信頼度</th>
              <th scope="col" className="dc-th">最終確認</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="hover:bg-[var(--hover)]">
                <th scope="row" className="dc-td text-left">
                  <Link
                    href={`/sources/${s.id}`}
                    className="font-medium text-[var(--ink)] hover:text-[var(--blue)] hover:underline"
                  >
                    {s.name}
                  </Link>
                  <div className="mt-[3px] flex flex-wrap gap-[3px]">
                    {s.tags.map(({ tag }) => (
                      <Link
                        key={tag.id}
                        href={`/sources?tag=${tag.id}`}
                        className="rounded-[5px] bg-[var(--subtle)] px-1.5 py-px font-mono text-[10px] text-[var(--ink-2)] hover:bg-[var(--line)]"
                      >
                        {tag.name}
                      </Link>
                    ))}
                  </div>
                </th>
                <td className="dc-td">{s.provider.name}</td>
                <td className="dc-td">{categoryLabel(s.category)}</td>
                <td className="dc-td">{s.dataFormat}</td>
                <td className="dc-td">{s.requiresApiKey ? "必要" : "不要"}</td>
                <td className="dc-td">
                  <StatusBadge status={s.status} />
                </td>
                <td className="dc-td">
                  <QualityScoreBadge score={s.qualityScore} />
                </td>
                <td className="dc-td">
                  <TrustLevelBadge level={s.trustLevel} />
                </td>
                <td className="dc-td text-[11.5px] text-[var(--muted)]">
                  {s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "未確認"}
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={9} className="dc-td text-center text-[var(--muted)]">
                  条件に一致するデータソースがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
