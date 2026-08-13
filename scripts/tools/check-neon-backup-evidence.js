#!/usr/bin/env node

const fs = require("node:fs");

const DEFAULT_MIN_HISTORY_WINDOW_HOURS = 24;
const DEFAULT_MAX_PG_DUMP_AGE_HOURS = 24;
const DEFAULT_MAX_RESTORE_DRILL_AGE_DAYS = 30;
const DEFAULT_MAX_HISTORY_MEASUREMENT_AGE_HOURS = 24;

const REQUIRED_STRING_FIELDS = [
  "projectId",
  "branch",
  "endpointHost",
  "lastPgDumpStatus",
  "lastPgDumpArtifact",
  "restoreDrillStatus",
  "restoreDrillStatusSource",
  "owner",
  "historyRetentionSource",
];

const REQUIRED_DATE_FIELDS = ["checkedAt", "lastPgDumpAt", "lastRestoreDrillAt"];

// Recognised provenance for the drill outcome. A closed vocabulary: an
// unrecognised token is reported as unrecognised rather than read for its
// prefix, so a future provenance has to be added here deliberately instead of
// being accepted because it happened to start with the right characters.
const KNOWN_RESTORE_DRILL_STATUS_SOURCES = new Set(["declared:--restore-drill-status"]);

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
    maxHistoryMeasurementAgeHours: DEFAULT_MAX_HISTORY_MEASUREMENT_AGE_HOURS,
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
    else if (arg === "--max-history-measurement-age-hours")
      options.maxHistoryMeasurementAgeHours = parsePositiveNumber(next(), arg);
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
    rows.push([label, ok, redact(detail), true]);
    if (!ok) failures.push(`${label}: ${redact(detail)}`);
  }

  // Recorded in the report but never able to fail the gate.
  function note(label, ok, detail) {
    rows.push([label, ok, redact(detail), false]);
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

  // The PITR window gate reads the *measured* retention only.
  //
  // `historyWindowHours` used to be the gate input, but it was supplied on the
  // command line by the same workflow run the gate audits: the run declared a
  // number and then checked its own declaration. A missing measurement is a
  // failure, not a reason to fall back to the declaration -- otherwise the
  // circularity returns through the error path.
  const measuredSeconds = Number(evidence.historyRetentionSecondsMeasured);
  const measuredPresent = Number.isFinite(measuredSeconds) && measuredSeconds >= 0;
  add(
    "historyRetentionSecondsMeasured present",
    measuredPresent,
    measuredPresent
      ? `${measuredSeconds}s measured from the Neon API`
      : `${safeValue(evidence.historyRetentionSecondsMeasured)} (no measured PITR retention; self-declared values are not accepted)`,
  );

  if (measuredPresent) {
    const measuredHours = measuredSeconds / 3600;
    add(
      "measured PITR retention meets minimum",
      measuredHours >= options.minHistoryWindowHours,
      `${measuredHours.toFixed(2)}h measured (minimum ${options.minHistoryWindowHours}h)`,
    );
  }

  // A measurement that is never refreshed decays into a slow-moving
  // declaration, so it carries its own freshness bound.
  let measuredAt = null;
  try {
    measuredAt = parseDate(evidence.historyRetentionMeasuredAt, "historyRetentionMeasuredAt");
  } catch {
    measuredAt = null;
  }
  if (measuredAt === null) {
    add("historyRetentionMeasuredAt ISO date", false, safeValue(evidence.historyRetentionMeasuredAt));
  } else {
    const ageHours = hoursBetween(options.now, measuredAt);
    add(
      "historyRetentionMeasuredAt is fresh",
      ageHours >= 0 && ageHours <= options.maxHistoryMeasurementAgeHours,
      `${ageHours.toFixed(1)}h old (maximum ${options.maxHistoryMeasurementAgeHours}h)`,
    );
  }

  // Measuring the wrong project would otherwise produce a green gate for a
  // project nobody is backing up.
  const measuredProjectId = String(evidence.historyRetentionProjectId ?? "").trim();
  add(
    "historyRetentionProjectId matches projectId",
    measuredProjectId.length > 0 && measuredProjectId === String(evidence.projectId ?? "").trim(),
    `${safeValue(evidence.historyRetentionProjectId)} vs ${safeValue(evidence.projectId)}`,
  );

  // Informational: drift between what the pipeline believes and what Neon
  // reports. Never gating -- gating on a declaration is the defect this
  // replaced.
  const declaredHours = Number(evidence.historyWindowHoursDeclared);
  if (Number.isFinite(declaredHours) && measuredPresent) {
    const measuredHours = measuredSeconds / 3600;
    note(
      "declared window agrees with measurement",
      Math.abs(declaredHours - measuredHours) < 1e-9,
      `declared ${declaredHours}h vs measured ${measuredHours.toFixed(2)}h (informational)`,
    );
  }

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

  // These two assertions are unchanged, but what reaches them is not. Both
  // statuses used to originate from a hardcoded "success" in the generator
  // that no caller overrode, so the checker was comparing a literal with
  // itself. The generator now measures the dump status from the artifact and
  // refuses to emit evidence when the drill outcome is not supplied, which is
  // what gives these lines a path to failure.
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

  // Non-gating on purpose: the generator already refuses to write evidence
  // without these, so failing here would only catch hand-forged documents.
  // They are surfaced so a reader of the report can tell a measured status
  // from a declared one without opening the JSON.
  note(
    "lastPgDumpStatus was measured, not declared",
    String(evidence.lastPgDumpStatusSource ?? "").startsWith("artifact-stat:"),
    safeValue(evidence.lastPgDumpStatusSource ?? "(not recorded)"),
  );
  note(
    "restoreDrillRecord referenced",
    String(evidence.restoreDrillRecord ?? "").trim().length > 0,
    safeValue(evidence.restoreDrillRecord ?? "(not recorded)"),
  );
  // Deliberately not "was measured": a drill outcome has no measured path, so
  // claiming one would be the misreading this row exists to prevent. What is
  // checkable is whether the provenance is one this gate recognises.
  const drillStatusSource = String(evidence.restoreDrillStatusSource ?? "").trim();
  const drillStatusSourceKnown = KNOWN_RESTORE_DRILL_STATUS_SOURCES.has(drillStatusSource);
  note(
    "restoreDrillStatusSource is a recognised provenance",
    drillStatusSourceKnown,
    drillStatusSourceKnown
      ? `${safeValue(drillStatusSource)} (declared by the operator; no measured path exists for a drill outcome)`
      : `${safeValue(drillStatusSource || "(not recorded)")} (not in the recognised vocabulary; the provenance cannot be graded)`,
  );

  return { ok: failures.length === 0, rows, failures };
}

function buildReport(evidence, options) {
  const result = checkEvidence(evidence, options);
  const lines = [
    "# Neon Backup Evidence Gate",
    "",
    `- Overall: ${result.ok ? "✅ backup evidence fresh" : "⚠️ backup evidence incomplete or stale"}`,
    `- Minimum PITR history window: ${options.minHistoryWindowHours}h (judged on the measured value only)`,
    `- Maximum PITR measurement age: ${options.maxHistoryMeasurementAgeHours}h`,
    `- Maximum pg_dump age: ${options.maxPgDumpAgeHours}h`,
    `- Maximum restore drill age: ${options.maxRestoreDrillAgeDays}d`,
    "",
    "| Check | State | Detail |",
    "| --- | --- | --- |",
    ...result.rows.map(([label, ok, detail, gating = true]) => {
      const state = ok ? "✅" : gating ? "⚠️" : "ℹ️";
      return `| ${label} | ${state} | ${detail} |`;
    }),
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
    "",
    "Notes:",
    "  The PITR window is judged on historyRetentionSecondsMeasured (measured from the Neon API).",
    "  A missing measurement fails the gate; the self-declared historyWindowHours is never used to pass it.",
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
