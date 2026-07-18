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
    <div className="space-y-4">
      <h1 className="text-xl font-bold">➕ データソース登録</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {canManage ? (
          <SourceForm
            providers={providers.map((p) => ({ id: p.id, name: p.name }))}
            tags={tags.map((t) => ({ id: t.id, name: t.name }))}
          />
        ) : (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            管理セッションが必要です。
            <Link href="/settings" className="ml-1 font-medium underline">
              設定画面
            </Link>
            で管理操作トークンを確認してください。
          </div>
        )}
      </div>
    </div>
  );
}
