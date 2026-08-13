import { PrismaClient } from "@prisma/client";
import { DEFAULT_ROLES, INITIAL_TAGS, PROVIDERS, SOURCES } from "./seed-data";
import { seedWeatherDemo } from "./seed-weather-demo";

const prisma = new PrismaClient();

async function main() {
  // --- RBAC roles ---
  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { priority: role.priority, note: role.note },
      create: role,
    });
  }

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

  // --- デモRBAC割当（ローカル/共有previewのデモ識別子向け。本番では未使用） ---
  const DEMO_ROLE_ASSIGNMENTS = [
    { userEmail: "demo.engineer@example.com", role: "engineer" },
    { userEmail: "demo.steward@example.com", role: "data-steward" },
  ] as const;
  for (const assignment of DEMO_ROLE_ASSIGNMENTS) {
    const role = await prisma.role.findUnique({ where: { name: assignment.role } });
    if (!role) continue;
    const existing = await prisma.roleAssignment.findFirst({
      where: { userEmail: assignment.userEmail, roleId: role.id, scope: "global", revokedAt: null },
    });
    if (!existing) {
      await prisma.roleAssignment.create({
        data: {
          userEmail: assignment.userEmail,
          roleId: role.id,
          scope: "global",
          grantedBy: "seed(demo)",
        },
      });
    }
  }

  // --- デモウォッチリスト（demo.engineer@example.com / 現場・データソース各1件） ---
  const DEMO_WATCH_EMAIL = "demo.engineer@example.com";
  const demoSite = await prisma.constructionSite.findFirst({ orderBy: { code: "asc" } });
  const demoSource = await prisma.dataSource.findFirst({ orderBy: { name: "asc" } });
  const demoWatchTargets: { targetType: string; targetId: string }[] = [];
  if (demoSite) demoWatchTargets.push({ targetType: "site", targetId: demoSite.id });
  if (demoSource) demoWatchTargets.push({ targetType: "dataSource", targetId: demoSource.id });
  for (const target of demoWatchTargets) {
    await prisma.watchlistEntry.upsert({
      where: {
        userEmail_targetType_targetId: {
          userEmail: DEMO_WATCH_EMAIL,
          targetType: target.targetType,
          targetId: target.targetId,
        },
      },
      update: { enabled: true },
      create: {
        userEmail: DEMO_WATCH_EMAIL,
        targetType: target.targetType,
        targetId: target.targetId,
        enabled: true,
      },
    });
  }

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
