import { DEFAULT_ROLES, INITIAL_TAGS, PROVIDERS, SOURCES } from "./seed-data";
import { seedWeatherDemo } from "./seed-weather-demo";

type PgClientModule = typeof import("../node_modules/.prisma/client-postgresql");

async function main() {
  const { PrismaClient } = (await import("../node_modules/.prisma/client-postgresql")) as PgClientModule;
  const prisma = new PrismaClient();

  try {
    for (const role of DEFAULT_ROLES) {
      await prisma.role.upsert({
        where: { name: role.name },
        update: { priority: role.priority, note: role.note },
        create: role,
      });
    }

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

    const tagMap = new Map<string, string>();
    for (const t of INITIAL_TAGS) {
      const tag = await prisma.tag.upsert({
        where: { name: t.name },
        update: { color: t.color },
        create: t,
      });
      tagMap.set(tag.name, tag.id);
    }

    for (const s of SOURCES) {
      const { providerName, tags, useCases, ...data } = s;
      const providerId = providerMap.get(providerName);
      if (!providerId) {
        throw new Error(`Unknown provider in seed data: ${providerName}`);
      }

      const source = await prisma.dataSource.upsert({
        where: { officialUrl: data.officialUrl },
        update: { ...data, providerId },
        create: { ...data, providerId },
      });

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

    await seedWeatherDemo(prisma);

    const nationalLandSource = await prisma.dataSource.findUnique({
      where: { officialUrl: "https://nlftp.mlit.go.jp/ksj/" },
      select: { id: true, officialUrl: true, licenseName: true },
    });
    if (!nationalLandSource) {
      throw new Error("PostgreSQL seed standard records require 国土数値情報 source");
    }

    const sampleTimestamp = new Date("2026-01-01T00:00:00.000Z");
    await prisma.$executeRaw`
      INSERT INTO "standard_records" (
        "id",
        "dataSourceId",
        "sourceRecordId",
        "category",
        "title",
        "description",
        "prefectureCode",
        "municipalityCode",
        "address",
        "geometry",
        "observedAt",
        "publishedAt",
        "retrievedAt",
        "sourceUrl",
        "licenseId",
        "qualityStatus",
        "rawDataReference",
        "properties",
        "createdAt",
        "updatedAt"
      ) VALUES (
        'std_seed_tokyo_station_risk_sample',
        ${nationalLandSource.id},
        'tokyo-station-risk-sample',
        'gis',
        '東京駅周辺 標準レコード検証ポイント',
        'PostGIS standard_records 読取経路を検証するための公開データ形式サンプル。実際の施工判断には使用しない。',
        '13',
        '13101',
        '東京都千代田区丸の内一丁目',
        ST_SetSRID(ST_MakePoint(139.767125, 35.681236), 4326),
        ${sampleTimestamp},
        ${sampleTimestamp},
        ${sampleTimestamp},
        ${nationalLandSource.officialUrl},
        ${nationalLandSource.licenseName},
        'usable',
        'seed:postgresql:standard_records',
        ${JSON.stringify({
          sourceDataset: "国土数値情報",
          samplePurpose: "runtime_standard_records_smoke",
          official: true,
          internalNote: "must be removed by DTO sanitization",
          apiToken: "must-not-leak",
        })}::jsonb,
        ${sampleTimestamp},
        ${sampleTimestamp}
      )
      ON CONFLICT ("id") DO UPDATE SET
        "dataSourceId" = EXCLUDED."dataSourceId",
        "sourceRecordId" = EXCLUDED."sourceRecordId",
        "category" = EXCLUDED."category",
        "title" = EXCLUDED."title",
        "description" = EXCLUDED."description",
        "prefectureCode" = EXCLUDED."prefectureCode",
        "municipalityCode" = EXCLUDED."municipalityCode",
        "address" = EXCLUDED."address",
        "geometry" = EXCLUDED."geometry",
        "observedAt" = EXCLUDED."observedAt",
        "publishedAt" = EXCLUDED."publishedAt",
        "retrievedAt" = EXCLUDED."retrievedAt",
        "sourceUrl" = EXCLUDED."sourceUrl",
        "licenseId" = EXCLUDED."licenseId",
        "qualityStatus" = EXCLUDED."qualityStatus",
        "rawDataReference" = EXCLUDED."rawDataReference",
        "properties" = EXCLUDED."properties",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    const [sourceCount, standardRecordCount] = await Promise.all([
      prisma.dataSource.count(),
      prisma.standardRecord.count(),
    ]);
    console.log(
      `PostgreSQL seed completed: ${sourceCount} data sources and ${standardRecordCount} standard records registered.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
