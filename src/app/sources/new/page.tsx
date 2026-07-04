import { prisma } from "@/lib/db";
import { SourceForm } from "@/components/SourceForm";

export const dynamic = "force-dynamic";

export default async function NewSourcePage() {
  const [providers, tags] = await Promise.all([
    prisma.provider.findMany({ orderBy: { name: "asc" } }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">➕ データソース登録</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <SourceForm
          providers={providers.map((p) => ({ id: p.id, name: p.name }))}
          tags={tags.map((t) => ({ id: t.id, name: t.name }))}
        />
      </div>
    </div>
  );
}
