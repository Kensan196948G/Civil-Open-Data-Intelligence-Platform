#!/usr/bin/env node

const fs = require("node:fs");

const DEFAULT_MIN_HISTORY_WINDOW_HOURS = 24;
const DEFAULT_MAX_PG_DUMP_AGE_HOURS = 24;
const DEFAULT_MAX_RESTORE_DRILL_AGE_DAYS = 30;

const REQUIRED_STRING_FIELDS = [
  "projectId",
  "branch",
  "lastPgDumpStatus",
  "lastPgDumpArtifact",
  "restoreDrillStatus",
  "owner",
];

const REQUIRED_DATE_FIELDS = ["checkedAt", "lastPgDumpAt", "lastRestoreDrillAt"];

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s|]+/gi,
  /[a-z0-9+.-]+:\/\/[^\s|]*:[^\s|@]+@[^\s|]+/gi,
  /\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^,\s|}]+/gi,
];

function parseArgs(argv) {
  const options = {
    evidenceJson: process.env.CODIP_NEON_BACKUP_EVIDENCE_JSON ?? "",
    evidenceFile: "",
    now: new Date(),
    minHistoryWindowHours: DEFAULT_MIN_HISTORY_WINDOW_HOURS,
    maxPgDumpAgeHours: DEFAULT_MAX_PG_DUMP_AGE_HOURS,
    maxRestoreDrillAgeDays: DEFAULT_MAX_RESTORE_DRILL_AGE_DAYS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--evidence-json") options.evidenceJson = next();
    else if (arg === "--evidence-file") options.evidenceFile = next();
    else if (arg === "--now") options.now = parseDate(next(), "--now");
    else if (arg === "--min-history-window-hours") options.minHistoryWindowHours = parsePositiveNumber(next(), arg);
    else if (arg === "--max-pg-dump-age-hours") options.maxPgDumpAgeHours = parsePositiveNumber(next(), arg);
    else if (arg === "--max-restore-drill-age-days") options.maxRestoreDrillAgeDays = parsePositiveNumber(next(), arg);
    else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be a positive number`);
  return number;
}

function parseDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO date`);
  return date;
}

function readEvidence(options) {
  if (options.evidenceFile) return fs.readFileSync(options.evidenceFile, "utf8");
  return options.evidenceJson;
}

function redact(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match) => {
      if (/postgres/i.test(match)) return "[REDACTED_POSTGRES_URL]";
      return "[REDACTED_SECRET]";
    });
  }
  return text;
}

function safeValue(value) {
  const redacted = redact(value);
  if (!redacted.trim()) return "(empty)";
  return redacted.length > 120 ? `${redacted.slice(0, 117)}...` : redacted;
}

function hoursBetween(now, earlier) {
  return (now.getTime() - earlier.getTime()) / (60 * 60 * 1000);
}

function daysBetween(now, earlier) {
  return hoursBetween(now, earlier) / 24;
}

function checkEvidence(evidence, options) {
  const rows = [];
  const failures = [];

  function add(label, ok, detail) {
    rows.push([label, ok, redact(detail)]);
    if (!ok) failures.push(`${label}: ${redact(detail)}`);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = evidence[field];
    add(`${field} present`, typeof value === "string" && value.trim().length > 0, safeValue(value));
  }

  for (const field of REQUIRED_DATE_FIELDS) {
    try {
      parseDate(evidence[field], field);
      add(`${field} ISO date`, true, evidence[field]);
    } catch {
      add(`${field} ISO date`, false, safeValue(evidence[field]));
    }
  }

  const historyWindowHours = Number(evidence.historyWindowHours);
  add(
    "historyWindowHours meets minimum",
    Number.isFinite(historyWindowHours) && historyWindowHours >= options.minHistoryWindowHours,
    `${Number.isFinite(historyWindowHours) ? historyWindowHours : safeValue(evidence.historyWindowHours)}h (minimum ${options.minHistoryWindowHours}h)`,
  );

  const lastPgDumpAt = new Date(evidence.lastPgDumpAt);
  if (!Number.isNaN(lastPgDumpAt.getTime())) {
    const ageHours = hoursBetween(options.now, lastPgDumpAt);
    add(
      "lastPgDumpAt is fresh",
      ageHours >= 0 && ageHours <= options.maxPgDumpAgeHours,
      `${ageHours.toFixed(1)}h old (maximum ${options.maxPgDumpAgeHours}h)`,
    );
  }

  const lastRestoreDrillAt = new Date(evidence.lastRestoreDrillAt);
  if (!Number.isNaN(lastRestoreDrillAt.getTime())) {
    const ageDays = daysBetween(options.now, lastRestoreDrillAt);
    add(
      "lastRestoreDrillAt is fresh",
      ageDays >= 0 && ageDays <= options.maxRestoreDrillAgeDays,
      `${ageDays.toFixed(1)}d old (maximum ${options.maxRestoreDrillAgeDays}d)`,
    );
  }

  add(
    "lastPgDumpStatus is success",
    String(evidence.lastPgDumpStatus ?? "").trim().toLowerCase() === "success",
    safeValue(evidence.lastPgDumpStatus),
  );
  add(
    "restoreDrillStatus is success",
    String(evidence.restoreDrillStatus ?? "").trim().toLowerCase() === "success",
    safeValue(evidence.restoreDrillStatus),
  );

  return { ok: failures.length === 0, rows, failures };
}

function buildReport(evidence, options) {
  const result = checkEvidence(evidence, options);
  const lines = [
    "# Neon Backup Evidence Gate",
    "",
    `- Overall: ${result.ok ? "✅ backup evidence fresh" : "⚠️ backup evidence incomplete or stale"}`,
    `- Minimum PITR history window: ${options.minHistoryWindowHours}h`,
    `- Maximum pg_dump age: ${options.maxPgDumpAgeHours}h`,
    `- Maximum restore drill age: ${options.maxRestoreDrillAgeDays}d`,
    "",
    "| Check | State | Detail |",
    "| --- | --- | --- |",
    ...result.rows.map(([label, ok, detail]) => `| ${label} | ${ok ? "✅" : "⚠️"} | ${detail} |`),
    "",
  ];

  return { ...result, text: lines.join("\n") };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/tools/check-neon-backup-evidence.js --evidence-json '<json>'",
    "  node scripts/tools/check-neon-backup-evidence.js --evidence-file evidence/neon-backup.json",
    "",
    "Environment:",
    "  CODIP_NEON_BACKUP_EVIDENCE_JSON may provide the same JSON payload.",
  ].join("\n");
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    const raw = readEvidence(options);
    if (!raw.trim()) throw new Error("Neon backup evidence JSON is required");
    const evidence = JSON.parse(raw);
    const report = buildReport(evidence, options);
    console.log(report.text);
    if (!report.ok) process.exit(1);
  } catch (error) {
    console.error(`[neon-backup-evidence][error] ${redact(error.message)}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildReport, checkEvidence, parseArgs, redact };
