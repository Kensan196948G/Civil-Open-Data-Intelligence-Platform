#!/usr/bin/env node
"use strict";

/**
 * ウォッチリスト通知チェック（更新遅延・ジョブ失敗・判定閾値超過）。
 *
 * WatchlistEntry ごとに、対象の鮮度（sla-monitor と同一基準）・ジョブ失敗・
 * 現場の直近判定（caution/stop）を突き合わせ、利用者別ダイジェストを生成する。
 * 読み取りのみ。通知の配信（GitHub Issue等）はワークフロー側で実施する。
 *
 * 使い方:
 *   DATABASE_URL=postgres://... node scripts/ingestion/notification-check.js [--json]
 */

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");
const { MAX_AGE_HOURS } = require("./sla-monitor");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function jobFreshness(job, now = new Date()) {
  const maxAgeHours = MAX_AGE_HOURS[job.dataSource.updateFrequency];
  if (maxAgeHours === undefined) return { state: "not-tracked" };
  if (!job.lastRunAt) return { state: "never-run", reason: "有効だが未実行" };
  const ageHours = (now.getTime() - job.lastRunAt.getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return { state: "stale", reason: `${ageHours.toFixed(1)}h old (max ${maxAgeHours}h)`, ageHours };
  }
  return { state: "ok", reason: `${ageHours.toFixed(1)}h old`, ageHours };
}

/**
 * ウォッチリストと実体を突き合わせ、利用者別の通知項目を生成する（純関数・テスト対象）。
 * @param {Array} entries WatchlistEntry[]
 * @param {Array} jobs IngestionJob[] (dataSource.provider 付き)
 * @param {Array} decisions DecisionRecord[]（siteId・status 付き）
 * @param {Date} [now]
 */
function buildNotifications(entries, jobs, decisions, now = new Date()) {
  const jobByDataSource = new Map(jobs.map((j) => [j.dataSourceId, j]));
  const decisionsBySite = new Map();
  for (const decision of decisions) {
    const current = decisionsBySite.get(decision.siteId);
    if (!current || decision.generatedAt > current.generatedAt) {
      decisionsBySite.set(decision.siteId, decision);
    }
  }

  const byUser = new Map();
  for (const entry of entries) {
    if (!entry.enabled) continue;
    const email = normalizeEmail(entry.userEmail);
    const items = byUser.get(email) ?? [];
    if (entry.targetType === "ingestionJob") {
      const job = jobs.find((j) => j.id === entry.targetId);
      if (job) {
        const freshness = jobFreshness(job, now);
        const failed = job.lastStatus === "failed" || job.retryCount >= job.maxRetries;
        if (freshness.state === "stale" || freshness.state === "never-run" || failed) {
          items.push({
            kind: "job",
            targetId: entry.targetId,
            jobName: job.name,
            state: freshness.state === "ok" ? (failed ? "failed" : "ok") : freshness.state,
            reason: failed ? `lastStatus=${job.lastStatus} retry=${job.retryCount}/${job.maxRetries}` : freshness.reason,
          });
        }
      }
    } else if (entry.targetType === "dataSource") {
      const job = jobByDataSource.get(entry.targetId);
      if (job) {
        const freshness = jobFreshness(job, now);
        const failed = job.lastStatus === "failed" || job.retryCount >= job.maxRetries;
        if (freshness.state === "stale" || freshness.state === "never-run" || failed) {
          items.push({
            kind: "dataSource",
            targetId: entry.targetId,
            sourceName: job.dataSource.name,
            state: freshness.state === "ok" ? (failed ? "failed" : "ok") : freshness.state,
            reason: failed ? `lastStatus=${job.lastStatus} retry=${job.retryCount}/${job.maxRetries}` : freshness.reason,
          });
        }
      }
    } else if (entry.targetType === "site") {
      const decision = decisionsBySite.get(entry.targetId);
      if (decision && decision.status !== "go") {
        items.push({
          kind: "site",
          targetId: entry.targetId,
          state: decision.status,
          reason: `直近判定=${decision.status}（${decision.generatedAt.toISOString()}）`,
        });
      }
    }
    byUser.set(email, items);
  }
  return [...byUser.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([userEmail, notifications]) => ({ userEmail, notifications }));
}

function toMarkdown(digest) {
  if (digest.length === 0) return "ウォッチリスト通知はありません。";
  const lines = ["# データウォッチ通知ダイジェスト", ""];
  for (const user of digest) {
    lines.push(`## ${user.userEmail}`, "");
    for (const item of user.notifications) {
      lines.push(`- [${item.kind}:${item.state}] ${item.targetId} — ${item.reason}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  return { json: argv.includes("--json"), help: argv.includes("--help") || argv.includes("-h") };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/ingestion/notification-check.js [--json]");
    process.exit(0);
  }
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("missing DATABASE_URL");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const [entries, jobs, decisions] = await Promise.all([
      prisma.watchlistEntry.findMany({ where: { enabled: true } }),
      prisma.ingestionJob.findMany({
        where: { enabled: true },
        include: { dataSource: { include: { provider: true } } },
      }),
      prisma.decisionRecord.findMany({
        select: { siteId: true, status: true, generatedAt: true },
        orderBy: { generatedAt: "desc" },
        take: 2000,
      }),
    ]);
    const digest = buildNotifications(entries, jobs, decisions);
    if (options.json) {
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), digest }, null, 2));
    } else {
      console.log(toMarkdown(digest));
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[notification-check][error] ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = { buildNotifications, jobFreshness, normalizeEmail, toMarkdown };
