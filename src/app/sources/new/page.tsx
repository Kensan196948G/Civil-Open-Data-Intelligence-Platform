import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { SourceForm } from "@/components/SourceForm";

export const dynamic = "force-dynamic";

export default async function NewSourcePage() {
  const canManage = isAdminHeaders(await headers());
  const [providers, tags] = await Promise.all([
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex max-w-[760px] flex-col gap-[14px]">
      <h1 className="text-[1.3rem] font-semibold">➕ データソース登録</h1>
      {canManage ? (
        <SourceForm
          providers={providers.map((p) => ({ id: p.id, name: p.name }))}
          tags={tags.map((t) => ({ id: t.id, name: t.name }))}
        />
      ) : (
        <div className="dc-card px-[18px] py-[13px] text-[12.5px] text-[var(--amber)]">
          管理セッションが必要です。
          <Link href="/settings" className="ml-1 font-semibold underline">
            設定画面
          </Link>
          で管理操作トークンを確認してください。
        </div>
      )}
    </div>
  );
}
