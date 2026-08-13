#!/usr/bin/env node
"use strict";

/**
 * ロール割当の定期棚卸し（運用用・読み取りのみ）。
 *
 * 有効な割当を一覧し、期限切れ・期限間近（既定14日以内）を強調する。
 * --strict 時は期限切れまたは7日以内に期限が来る割当があると非ゼロ終了。
 *
 * 使い方:
 *   DATABASE_URL=postgres://... node scripts/tools/review-role-assignments.js [--strict] [--expiring-days 14]
 */

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");

function classifyAssignment(assignment, now = new Date(), expiringDays = 14) {
  if (!assignment.expiresAt) return { ...assignment, status: "active", note: "期限なし" };
  const ms = assignment.expiresAt.getTime() - now.getTime();
  const days = ms / 86_400_000;
  if (ms <= 0) return { ...assignment, status: "expired", note: `期限切れ ${(-days).toFixed(1)}日前`, days };
  if (days <= expiringDays) return { ...assignment, status: "expiring", note: `あと ${days.toFixed(1)}日`, days };
  return { ...assignment, status: "active", note: `あと ${days.toFixed(1)}日`, days };
}

function buildReport(assignments, now = new Date(), expiringDays = 14) {
  const rows = assignments.map((a) => classifyAssignment(a, now, expiringDays));
  const expired = rows.filter((r) => r.status === "expired");
  const expiring = rows.filter((r) => r.status === "expiring");
  return { rows, expired, expiring, ok: expired.length === 0 && expiring.length === 0 };
}

function parseArgs(argv) {
  const options = { strict: false, expiringDays: 14, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--strict") options.strict = true;
    else if (arg === "--expiring-days") {
      i += 1;
      options.expiringDays = Math.max(1, Number(argv[i]) || 14);
    } else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/tools/review-role-assignments.js [--strict] [--expiring-days N]");
    process.exit(0);
  }
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("missing DATABASE_URL");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const assignments = await prisma.roleAssignment.findMany({
      where: { revokedAt: null },
      include: { role: true },
      orderBy: { userEmail: "asc" },
    });
    const report = buildReport(assignments, new Date(), options.expiringDays);
    const lines = [
      "# Role Assignment Review",
      "",
      `- checkedAt: ${new Date().toISOString()}`,
      `- active: ${report.rows.length} / expired: ${report.expired.length} / expiring(<=${options.expiringDays}d): ${report.expiring.length}`,
      "",
      "| User | Role | Scope | ExpiresAt | Status | Note |",
      "| --- | --- | --- | --- | --- | --- |",
      ...report.rows.map(
        (r) =>
          `| ${r.userEmail} | ${r.role.name} | ${r.scope} | ${r.expiresAt?.toISOString() ?? "-"} | ${r.status} | ${r.note} |`,
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
    console.error(`[role-review][error] ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = { buildReport, classifyAssignment };
