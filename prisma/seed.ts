import { PrismaClient } from "@prisma/client";
import { INITIAL_TAGS, PROVIDERS, SOURCES } from "./seed-data";
import { seedWeatherDemo } from "./seed-weather-demo";

const prisma = new PrismaClient();

async function main() {
  // --- Providers ---
  const providerMap = new Map<string, string>();
  for (const p of PROVIDERS) {
    const provider = await prisma.provider.upsert({
      where: { name: p.name },
      update: {
        organizationType: p.organizationType,
        officialUrl: p.officialUrl,
        country: p.country,
      },
      create: p,
    });
    providerMap.set(provider.name, provider.id);
  }

  // --- Tags ---
  const tagMap = new Map<string, string>();
  for (const t of INITIAL_TAGS) {
    const tag = await prisma.tag.upsert({
      where: { name: t.name },
      update: { color: t.color },
      create: t,
    });
    tagMap.set(tag.name, tag.id);
  }

  // --- Data sources ---
  for (const s of SOURCES) {
    const { providerName, tags, useCases, ...data } = s;
    const providerId = providerMap.get(providerName);
    if (!providerId) {
      throw new Error(`Unknown provider in seed data: ${providerName}`);
    }

    const existing = await prisma.dataSource.findUnique({ where: { officialUrl: data.officialUrl } });
    const source = existing
      ? await prisma.dataSource.update({
          where: { id: existing.id },
          data: { ...data, providerId },
        })
      : await prisma.dataSource.create({ data: { ...data, providerId } });

    for (const tagName of tags) {
      const tagId = tagMap.get(tagName);
      if (!tagId) continue;
      await prisma.dataSourceTag.upsert({
        where: { dataSourceId_tagId: { dataSourceId: source.id, tagId } },
        update: {},
        create: { dataSourceId: source.id, tagId },
      });
    }

    for (const uc of useCases) {
      const found = await prisma.relatedUseCase.findFirst({
        where: { dataSourceId: source.id, useCaseName: uc.useCaseName },
      });
      if (!found) {
        await prisma.relatedUseCase.create({ data: { dataSourceId: source.id, ...uc } });
      }
    }
  }

  const count = await prisma.dataSource.count();
  await seedWeatherDemo(prisma);
  console.log(`Seed completed: ${count} data sources registered.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
