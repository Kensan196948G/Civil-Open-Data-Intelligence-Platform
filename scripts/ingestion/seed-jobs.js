#!/usr/bin/env node
"use strict";

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");

const ELIGIBLE_FORMATS = new Set(["CSV", "GeoJSON", "JSON", "XML"]);

async function main() {
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    console.error("[seed-jobs] missing DATABASE_URL");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const enable = process.argv.includes("--enable");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const candidates = await prisma.dataSource.findMany({
      where: {
        dataFormat: { in: [...ELIGIBLE_FORMATS] },
        requiresApiKey: false,
      },
      include: { provider: true },
      orderBy: { name: "asc" },
    });
    const sources = candidates.filter(
      (source) => source.status !== "deprecated" && Boolean(source.endpointUrl || source.officialUrl),
    );

    let created = 0;
    let enabled = 0;
    for (const source of sources) {
      const existing = await prisma.ingestionJob.findUnique({ where: { dataSourceId: source.id } });
      if (existing) {
        if (enable && !existing.enabled) {
          await prisma.ingestionJob.update({ where: { id: existing.id }, data: { enabled: true } });
          enabled += 1;
        }
        continue;
      }
      if (dryRun) continue;
      const targetUrl = source.endpointUrl || source.officialUrl || "";
      await prisma.ingestionJob.create({
        data: {
          dataSourceId: source.id,
          name: `${source.name} 定期収集`,
          enabled: enable,
          intervalMinutes: 1440,
          maxRecords: 100,
          nextRunAt: enable ? new Date() : null,
        },
      });
      created += 1;
      if (enable) enabled += 1;
    }

    console.log(
      `[seed-jobs] eligible=${sources.length} created=${created} enabled=${enabled} dryRun=${dryRun} enable=${enable}`,
    );
    if (dryRun) {
      for (const source of sources) {
        console.log(`- ${source.id} ${source.name} [${source.dataFormat}] ${source.endpointUrl || source.officialUrl}`);
      }
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[seed-jobs] ${error?.message || error}`);
  process.exit(1);
});
