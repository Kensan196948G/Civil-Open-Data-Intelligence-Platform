#!/usr/bin/env node
"use strict";

/**
 * データ品質SLA監視（提供元別・鮮度）。
 *
 * 有効な収集ジョブの lastRunAt を、データソースの updateFrequency から決まる
 * 最大許容鮮度と比較し、提供元別のサマリーと停滞ジョブ一覧を出力する。
 * --strict 時は停滞・未実行ジョブが1件でもあれば非ゼロ終了。
 *
 * 使い方:
 *   DATABASE_URL=postgres://... node scripts/ingestion/sla-monitor.js [--strict]
 */

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");

// updateFrequency -> 最大許容鮮度（時間）。irregular はSLA対象外。
const MAX_AGE_HOURS = {
  realtime: 6,
  "10min": 1,
  hourly: 4,
  daily: 30,
  weekly: 8 * 24,
  monthly: 35 * 24,
  yearly: 400 * 24,
};

function evaluateJob(job, now = new Date()) {
  const maxAgeHours = MAX_AGE_HOURS[job.dataSource.updateFrequency];
  if (maxAgeHours === undefined) return { ...job, sla: "not-tracked", reason: "irregular/unknown frequency" };
  if (!job.lastRunAt) return { ...job, sla: "never-run", reason: "有効だが未実行", maxAgeHours };
  const ageHours = (now.getTime() - job.lastRunAt.getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return {
      ...job,
      sla: "stale",
      reason: `${ageHours.toFixed(1)}h old (max ${maxAgeHours}h)`,
      maxAgeHours,
      ageHours,
    };
  }
  return { ...job, sla: "ok", reason: `${ageHours.toFixed(1)}h old (max ${maxAgeHours}h)`, maxAgeHours };
}

function buildReport(jobs, now = new Date()) {
  const evaluated = jobs.map((job) => evaluateJob(job, now));
  const byProvider = new Map();
  for (const item of evaluated) {
    const key = item.dataSource.provider?.name || "unknown";
    const entry = byProvider.get(key) ?? { ok: 0, stale: 0, "never-run": 0, "not-tracked": 0, total: 0 };
    entry[item.sla] += 1;
    entry.total += 1;
    byProvider.set(key, entry);
  }
  const stale = evaluated.filter((item) => item.sla === "stale" || item.sla === "never-run");
  return { evaluated, byProvider, stale, ok: stale.length === 0 };
}

function parseArgs(argv) {
  return { strict: argv.includes("--strict"), help: argv.includes("--help") || argv.includes("-h") };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/ingestion/sla-monitor.js [--strict]");
    process.exit(0);
  }
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("missing DATABASE_URL");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const jobs = await prisma.ingestionJob.findMany({
      where: { enabled: true },
      include: {
        dataSource: { include: { provider: true } },
      },
      orderBy: { nextRunAt: "asc" },
    });
    const report = buildReport(jobs);
    const lines = [
      "# Data Quality SLA Monitor",
      "",
      `- checkedAt: ${new Date().toISOString()}`,
      `- enabled jobs: ${jobs.length}`,
      `- stale / never-run: ${report.stale.length}`,
      "",
      "| Provider | OK | Stale | Never-run | Not-tracked | Total |",
      "| --- | --- | --- | --- | --- | --- |",
      ...[...report.byProvider.entries()].map(
        ([name, e]) => `| ${name} | ${e.ok} | ${e.stale} | ${e["never-run"]} | ${e["not-tracked"]} | ${e.total} |`,
      ),
      "",
      "## Stale / Never-run Jobs",
      "",
      "| Job | Provider | Frequency | LastRunAt | Reason |",
      "| --- | --- | --- | --- | --- |",
      ...report.stale.map(
        (j) =>
          `| ${j.name} | ${j.dataSource.provider?.name || "-"} | ${j.dataSource.updateFrequency} | ${j.lastRunAt?.toISOString() ?? "-"} | ${j.reason} |`,
      ),
      "",
    ];
    console.log(lines.join("\n"));
    if (options.strict && !report.ok) process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[sla-monitor][error] ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = { MAX_AGE_HOURS, buildReport, evaluateJob };
