import Link from "next/link";
import { prisma } from "@/lib/db";
import { TagForm } from "@/components/TagForm";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const tags = await prisma.tag.findMany({
    include: { _count: { select: { sources: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">🏷️ タグ管理</h1>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">➕ タグ追加</h2>
        <TagForm />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">📚 登録済みタグ</h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/sources?tag=${tag.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: tag.color ?? "#94a3b8" }}
              />
              {tag.name}
              <span className="text-xs text-slate-400">({tag._count.sources})</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
