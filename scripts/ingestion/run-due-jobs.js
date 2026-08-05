#!/usr/bin/env node
"use strict";

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../node_modules/.prisma/client-postgresql");
const { runDueIngestionJobs } = require("./ingestion-engine.js");

async function main() {
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    console.error("[ingestion] missing DATABASE_URL (CODIP_INGESTION_DATABASE_URL)");
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  const maxJobs = Number.parseInt(process.env.CODIP_INGESTION_MAX_JOBS_PER_TICK || "3", 10) || 3;
  const triggeredBy = process.env.CODIP_INGESTION_TRIGGERED_BY || "schedule";

  try {
    const result = await runDueIngestionJobs(prisma, { maxJobs, triggeredBy });
    console.log(
      `[ingestion] done jobs=${result.count} ` +
        result.jobs
          .map(
            (job) =>
              `${job.dataSourceId}:${job.status}(ins=${job.inserted},upd=${job.updated},skip=${job.skipped})`,
          )
          .join(" ") || "no-due-jobs",
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[ingestion] ${error?.message || error}`);
  process.exit(1);
});
