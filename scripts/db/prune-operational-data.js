#!/usr/bin/env node

const { loadPrismaClient } = require("../tools/prisma-client-loader");

const PrismaClient = loadPrismaClient();

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const logDays = Number(argValue("--log-days", process.env.CODIP_FETCH_LOG_RETENTION_DAYS ?? "90"));
  const sampleDays = Number(argValue("--sample-days", process.env.CODIP_SAMPLE_RETENTION_DAYS ?? "30"));
  const dryRun = hasArg("--dry-run");

  if (!Number.isInteger(logDays) || logDays < 1 || !Number.isInteger(sampleDays) || sampleDays < 1) {
    console.error("Usage: node scripts/db/prune-operational-data.js [--dry-run] [--log-days N] [--sample-days N]");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const logBefore = daysAgo(logDays);
  const sampleBefore = daysAgo(sampleDays);

  try {
    const [logs, samples] = await Promise.all([
      prisma.fetchLog.count({ where: { executedAt: { lt: logBefore } } }),
      prisma.sampleResponse.count({ where: { createdAt: { lt: sampleBefore } } }),
    ]);

    console.log(
      `[prune] candidates: fetch_logs=${logs} before=${logBefore.toISOString()}, sample_responses=${samples} before=${sampleBefore.toISOString()}`,
    );

    if (dryRun) {
      console.log("[prune] dry-run: no rows deleted");
      return;
    }

    const [deletedSamples, deletedLogs] = await prisma.$transaction([
      prisma.sampleResponse.deleteMany({ where: { createdAt: { lt: sampleBefore } } }),
      prisma.fetchLog.deleteMany({ where: { executedAt: { lt: logBefore } } }),
    ]);

    console.log(
      `[prune] deleted: fetch_logs=${deletedLogs.count}, sample_responses=${deletedSamples.count}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
