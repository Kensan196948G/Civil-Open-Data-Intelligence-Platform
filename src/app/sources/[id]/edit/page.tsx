import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { SourceForm } from "@/components/SourceForm";

export const metadata = {
  title: "データソース編集",
};

export const dynamic = "force-dynamic";

export default async function EditSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canManage = isAdminHeaders(await headers());
  const [source, providers, tags] = await Promise.all([
    prisma.dataSource.findUnique({
      where: { id },
      include: { tags: true },
    }),
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!source) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">✏️ データソース編集: {source.name}</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {canManage ? (
          <SourceForm
            sourceId={source.id}
            providers={providers.map((p) => ({ id: p.id, name: p.name }))}
            tags={tags.map((t) => ({ id: t.id, name: t.name }))}
            initialValues={{
              name: source.name,
              nameEn: source.nameEn ?? "",
              providerId: source.providerId,
              description: source.description ?? "",
              officialUrl: source.officialUrl,
              endpointUrl: source.endpointUrl ?? "",
              documentationUrl: source.documentationUrl ?? "",
              category: source.category,
              dataFormat: source.dataFormat,
              accessType: source.accessType,
              requiresApiKey: source.requiresApiKey,
              apiKeyEnvName: source.apiKeyEnvName ?? "",
              licenseName: source.licenseName ?? "",
              commercialUse: source.commercialUse,
              attributionRequired: source.attributionRequired,
              updateFrequency: source.updateFrequency ?? "",
              status: source.status,
              trustLevel: source.trustLevel,
              qualityScore: source.qualityScore,
              note: source.note ?? "",
              tagIds: source.tags.map((t) => t.tagId),
            }}
          />
        ) : (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            編集には管理セッションが必要です。
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
