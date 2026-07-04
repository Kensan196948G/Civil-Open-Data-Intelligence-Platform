import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SourceForm } from "@/components/SourceForm";

export const dynamic = "force-dynamic";

export default async function EditSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      </div>
    </div>
  );
}
