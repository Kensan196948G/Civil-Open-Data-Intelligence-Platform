import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { TagForm } from "@/components/TagForm";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  const canManage = isAdminHeaders(await headers());
  const tags = await prisma.tag.findMany({
    include: { _count: { select: { sources: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-[14px]">
      <h1 className="m-0 text-[1.4rem] font-semibold">🏷️ タグ管理</h1>

      {canManage ? (
        <div className="dc-card px-[18px] py-[17px]">
          <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">➕ タグ追加</h2>
          <TagForm />
        </div>
      ) : null}

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2.5 text-[14px] font-semibold text-[var(--ink)]">📚 登録済みタグ</h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/sources?tag=${tag.id}`}
              className="inline-flex items-center gap-1.5 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] px-[13px] py-1.5 text-[12.5px] hover:bg-[var(--hover)]"
            >
              <span
                aria-hidden="true"
                className="inline-block h-[9px] w-[9px] rounded-full"
                style={{ backgroundColor: tag.color ?? "#94a3b8" }}
              />
              {tag.name}
              <span className="text-[11px] text-[var(--faint)]">({tag._count.sources})</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
