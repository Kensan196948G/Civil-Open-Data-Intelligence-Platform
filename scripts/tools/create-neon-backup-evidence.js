#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s|]+/gi,
  /[a-z0-9+.-]+:\/\/[^\s|]*:[^\s|@]+@[^\s|]+/gi,
  /\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^,\s|}]+/gi,
];

function parseArgs(argv) {
  const options = {
    checkedAt: new Date(),
    pgDumpStatus: "success",
    restoreDrillStatus: "success",
    pretty: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--project-id") options.projectId = next();
    else if (arg === "--branch") options.branch = next();
    else if (arg === "--endpoint-host") options.endpointHost = next();
    else if (arg === "--history-window-hours") options.historyWindowHours = parsePositiveNumber(next(), arg);
    else if (arg === "--pg-dump-file") options.pgDumpFile = next();
    else if (arg === "--pg-dump-artifact") options.pgDumpArtifact = next();
    else if (arg === "--pg-dump-at") options.pgDumpAt = parseDate(next(), arg);
    else if (arg === "--pg-dump-status") options.pgDumpStatus = next();
    else if (arg === "--restore-drill-at") options.restoreDrillAt = parseDate(next(), arg);
    else if (arg === "--restore-drill-status") options.restoreDrillStatus = next();
    else if (arg === "--owner") options.owner = next();
    else if (arg === "--checked-at") options.checkedAt = parseDate(next(), arg);
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
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

function containsSecret(value) {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(value ?? ""));
  });
}

function requireText(options, key) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  if (containsSecret(value)) throw new Error(`${key} must not contain a secret-looking value`);
  return value.trim();
}

function iso(date) {
  return date.toISOString();
}

function artifactFromFile(filePath) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error("pg_dump artifact path must be a file");
  if (stats.size <= 0) throw new Error("pg_dump artifact file is empty");

  return {
    artifact: `file://${path.basename(filePath)}`,
    createdAt: stats.mtime,
    sizeBytes: stats.size,
  };
}

function buildEvidence(options) {
  const projectId = requireText(options, "projectId");
  const branch = requireText(options, "branch");
  const endpointHost = requireText(options, "endpointHost");
  const owner = requireText(options, "owner");
  const historyWindowHours = Number(options.historyWindowHours);
  if (!Number.isFinite(historyWindowHours) || historyWindowHours <= 0) {
    throw new Error("historyWindowHours is required");
  }

  let pgDumpArtifact = options.pgDumpArtifact;
  let lastPgDumpAt = options.pgDumpAt;
  let pgDumpSizeBytes;

  if (options.pgDumpFile) {
    if (containsSecret(options.pgDumpFile)) throw new Error("pgDumpFile must not contain a secret-looking value");
    const fileEvidence = artifactFromFile(options.pgDumpFile);
    pgDumpArtifact = pgDumpArtifact ?? fileEvidence.artifact;
    lastPgDumpAt = lastPgDumpAt ?? fileEvidence.createdAt;
    pgDumpSizeBytes = fileEvidence.sizeBytes;
  }

  if (typeof pgDumpArtifact !== "string" || !pgDumpArtifact.trim()) {
    throw new Error("pgDumpArtifact is required via --pg-dump-artifact or --pg-dump-file");
  }
  if (containsSecret(pgDumpArtifact)) throw new Error("pgDumpArtifact must not contain a secret-looking value");
  if (!(lastPgDumpAt instanceof Date)) throw new Error("pgDumpAt is required unless --pg-dump-file is provided");
  if (!(options.restoreDrillAt instanceof Date)) throw new Error("restoreDrillAt is required");

  const evidence = {
    checkedAt: iso(options.checkedAt),
    projectId,
    branch,
    endpointHost,
    historyWindowHours,
    lastPgDumpAt: iso(lastPgDumpAt),
    lastPgDumpStatus: requireText(options, "pgDumpStatus"),
    lastPgDumpArtifact: pgDumpArtifact.trim(),
    lastRestoreDrillAt: iso(options.restoreDrillAt),
    restoreDrillStatus: requireText(options, "restoreDrillStatus"),
    owner,
  };

  if (pgDumpSizeBytes !== undefined) evidence.pgDumpSizeBytes = pgDumpSizeBytes;
  return evidence;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/tools/create-neon-backup-evidence.js --project-id <id> --branch <branch> --endpoint-host <host> --history-window-hours <hours> --pg-dump-file <dump> --restore-drill-at <iso> --owner <role>",
    "  node scripts/tools/create-neon-backup-evidence.js --project-id <id> --branch <branch> --endpoint-host <host> --history-window-hours <hours> --pg-dump-artifact <artifact-id> --pg-dump-at <iso> --restore-drill-at <iso> --owner <role>",
    "",
    "Notes:",
    "  This tool never connects to Neon and never reads dump contents. It emits non-secret JSON for release:check-neon-backup-evidence.",
  ].join("\n");
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    const evidence = buildEvidence(options);
    console.log(JSON.stringify(evidence, null, options.pretty ? 2 : 0));
  } catch (error) {
    console.error(`[neon-backup-evidence-create][error] ${redact(error.message)}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildEvidence, parseArgs, redact };
