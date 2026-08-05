#!/usr/bin/env node
"use strict";

async function getQualityMonitoringSummary(prisma, options = {}) {
  const { hours = 24, now = new Date() } = options;
  const since = new Date(now.getTime() - hours * 3_600_000);

  const [groupedRuns, deadLetters, schemaChanges, enabledJobs] = await Promise.all([
    prisma.ingestionRun.groupBy({
      by: ["status"],
      where: { startedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.ingestionRun.findMany({
      where: { status: "dead_letter", startedAt: { gte: since } },
      include: { ingestionJob: { include: { dataSource: { select: { id: true, name: true } } } } },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    prisma.ingestionRun.findMany({
      where: { schemaChanged: true, startedAt: { gte: since } },
      include: { ingestionJob: { include: { dataSource: { select: { id: true, name: true } } } } },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    prisma.ingestionJob.findMany({
      where: { enabled: true },
      include: { dataSource: { select: { id: true, name: true } } },
      take: 200,
    }),
  ]);

  const statusCounts = Object.fromEntries(
    groupedRuns.map((row) => [row.status, row._count._all]),
  );
  const staleJobs = enabledJobs.filter(
    (job) => !job.lastRunAt || now.getTime() - job.lastRunAt.getTime() > job.intervalMinutes * 3 * 60_000,
  );

  const anomalies = [];
  for (const job of enabledJobs) {
    const successRuns = await prisma.ingestionRun.findMany({
      where: { ingestionJobId: job.id, status: "success" },
      orderBy: { startedAt: "desc" },
      take: 2,
      select: { recordsInserted: true, recordsUpdated: true, startedAt: true },
    });
    if (successRuns.length < 2) continue;
    const previous = successRuns[1].recordsInserted + successRuns[1].recordsUpdated;
    const current = successRuns[0].recordsInserted + successRuns[0].recordsUpdated;
    if (previous > 0 && current === 0) {
      anomalies.push({
        jobId: job.id,
        dataSourceName: job.dataSource.name,
        kind: "record_count_drop",
        detail: `前回${previous}件 → 今回0件`,
      });
    } else if (previous > 0 && current > previous * 3) {
      anomalies.push({
        jobId: job.id,
        dataSourceName: job.dataSource.name,
        kind: "record_count_surge",
        detail: `前回${previous}件 → 今回${current}件`,
      });
    }
  }

  return {
    checkedAt: now.toISOString(),
    windowHours: hours,
    statusCounts,
    deadLetters: deadLetters.map((run) => ({
      runId: run.id,
      jobId: run.ingestionJobId,
      dataSourceName: run.ingestionJob.dataSource.name,
      deadLetterReason: run.deadLetterReason ?? run.errorMessage,
      startedAt: run.startedAt,
    })),
    schemaChanges: schemaChanges.map((run) => ({
      runId: run.id,
      jobId: run.ingestionJobId,
      dataSourceName: run.ingestionJob.dataSource.name,
      note: run.note,
      startedAt: run.startedAt,
    })),
    staleJobs: staleJobs.map((job) => ({
      jobId: job.id,
      dataSourceName: job.dataSource.name,
      intervalMinutes: job.intervalMinutes,
      lastRunAt: job.lastRunAt,
    })),
    anomalies,
  };
}

function hasAnomalies(summary) {
  return (
    summary.deadLetters.length > 0 ||
    summary.schemaChanges.length > 0 ||
    summary.staleJobs.length > 0 ||
    summary.anomalies.length > 0
  );
}

async function main() {
  const { PrismaPg } = require("@prisma/adapter-pg");
  const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) {
    console.error("[quality-monitor] missing DATABASE_URL");
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const strict = process.argv.includes("--strict");
  try {
    const summary = await getQualityMonitoringSummary(prisma, {
      hours: Number.parseInt(process.env.CODIP_QUALITY_MONITOR_WINDOW_HOURS || "24", 10) || 24,
    });
    const anomalies = hasAnomalies(summary);
    console.log(`[quality-monitor] window=${summary.windowHours}h counts=${JSON.stringify(summary.statusCounts)}`);
    if (summary.deadLetters.length) {
      console.log(`[quality-monitor] dead_letter=${summary.deadLetters.length} (${summary.deadLetters[0].dataSourceName}: ${summary.deadLetters[0].deadLetterReason})`);
    }
    if (summary.schemaChanges.length) {
      console.log(`[quality-monitor] schema_changed=${summary.schemaChanges.length} (${summary.schemaChanges[0].dataSourceName})`);
    }
    if (summary.staleJobs.length) console.log(`[quality-monitor] stale_jobs=${summary.staleJobs.length}`);
    if (summary.anomalies.length) {
      for (const anomaly of summary.anomalies) {
        console.log(`[quality-monitor] anomaly ${anomaly.kind} ${anomaly.dataSourceName}: ${anomaly.detail}`);
      }
    }
    if (strict && anomalies) {
      console.error("[quality-monitor] strict mode: anomalies detected");
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

module.exports = { getQualityMonitoringSummary, hasAnomalies };

if (require.main === module) {
  main().catch((error) => {
    console.error(`[quality-monitor] ${error?.message || error}`);
    process.exit(1);
  });
}
