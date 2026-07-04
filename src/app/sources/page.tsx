import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CATEGORIES, DATA_FORMATS, SOURCE_STATUSES, categoryLabel } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { QualityScoreBadge, TrustLevelBadge } from "@/components/QualityScoreBadge";

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
  const where: Prisma.DataSourceWhereInput = {};
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q } },
      { nameEn: { contains: sp.q } },
      { description: { contains: sp.q } },
    ];
  }
  if (sp.category) where.category = sp.category;
  if (sp.providerId) where.providerId = sp.providerId;
  if (sp.dataFormat) where.dataFormat = sp.dataFormat;
  if (sp.requiresApiKey === "true") where.requiresApiKey = true;
  if (sp.requiresApiKey === "false") where.requiresApiKey = false;
  if (sp.status) where.status = sp.status;
  if (sp.tag) where.tags = { some: { tagId: sp.tag } };

  const [sources, providers, tags] = await Promise.all([
    prisma.dataSource.findMany({
      where,
      include: { provider: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  const selectCls = "rounded border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">📚 データソース一覧</h1>
        <Link
          href="/sources/new"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          ➕ 新規登録
        </Link>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div>
          <label className="mb-1 block text-xs text-slate-500">🔍 キーワード</label>
          <input name="q" defaultValue={sp.q ?? ""} className={selectCls} placeholder="河川、道路、標高..." />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">カテゴリ</label>
          <select name="category" defaultValue={sp.category ?? ""} className={selectCls}>
            <option value="">すべて</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">提供元</label>
          <select name="providerId" defaultValue={sp.providerId ?? ""} className={selectCls}>
            <option value="">すべて</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">形式</label>
          <select name="dataFormat" defaultValue={sp.dataFormat ?? ""} className={selectCls}>
            <option value="">すべて</option>
            {DATA_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">🔑 APIキー</label>
          <select name="requiresApiKey" defaultValue={sp.requiresApiKey ?? ""} className={selectCls}>
            <option value="">すべて</option>
            <option value="true">必要</option>
            <option value="false">不要</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">接続状態</label>
          <select name="status" defaultValue={sp.status ?? ""} className={selectCls}>
            <option value="">すべて</option>
            {SOURCE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">🏷️ タグ</label>
          <select name="tag" defaultValue={sp.tag ?? ""} className={selectCls}>
            <option value="">すべて</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
          🔍 検索
        </button>
        <Link href="/sources" className="px-2 py-1.5 text-sm text-slate-500 hover:underline">
          クリア
        </Link>
      </form>

      <p className="text-sm text-slate-500">📊 {sources.length} 件</p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-3 py-2">データソース名</th>
              <th className="px-3 py-2">提供元</th>
              <th className="px-3 py-2">カテゴリ</th>
              <th className="px-3 py-2">形式</th>
              <th className="px-3 py-2">🔑</th>
              <th className="px-3 py-2">接続状態</th>
              <th className="px-3 py-2">品質</th>
              <th className="px-3 py-2">信頼度</th>
              <th className="px-3 py-2">最終確認</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/sources/${s.id}`} className="font-medium text-blue-600 hover:underline">
                    {s.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {s.tags.map(({ tag }) => (
                      <Link
                        key={tag.id}
                        href={`/sources?tag=${tag.id}`}
                        className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600 hover:bg-slate-200"
                      >
                        {tag.name}
                      </Link>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">{s.provider.name}</td>
                <td className="px-3 py-2">{categoryLabel(s.category)}</td>
                <td className="px-3 py-2">{s.dataFormat}</td>
                <td className="px-3 py-2">{s.requiresApiKey ? "🔑" : "-"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-3 py-2">
                  <QualityScoreBadge score={s.qualityScore} />
                </td>
                <td className="px-3 py-2">
                  <TrustLevelBadge level={s.trustLevel} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleDateString("ja-JP") : "未確認"}
                </td>
              </tr>
            ))}
            {sources.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
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
