#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SECRET_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s|]+/gi,
  /[a-z0-9+.-]+:\/\/[^\s|]*:[^\s|@]+@[^\s|]+/gi,
  /\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^,\s|}]+/gi,
];

const DEFAULT_NEON_API_BASE_URL = "https://console.neon.tech/api/v2";
const DEFAULT_NEON_API_KEY_ENV = "NEON_API_KEY";
const DEFAULT_NEON_API_TIMEOUT_MS = 15000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// Deliberately mirrors the PASS/FAIL/BLOCKED/NOT RUN vocabulary of
// docs/runbooks/notification-test-record.md. A free-form status would let a
// typo be recorded as an outcome; a closed set forces the writer to pick one.
const KNOWN_STATUSES = new Set(["success", "failed", "partial", "not-run", "blocked"]);

function parseArgs(argv) {
  // pgDumpStatus and restoreDrillStatus deliberately have no defaults.
  //
  // They used to default to "success", and no caller ever overrode them, so
  // the generator wrote "success" and the gate read back the same literal --
  // an assertion with no path to failure that nonetheless recorded "the
  // restore drill succeeded" in the audit trail. Absent is now an error.
  const options = {
    checkedAt: new Date(),
    pretty: false,
    neonApiBaseUrl: DEFAULT_NEON_API_BASE_URL,
    neonApiKeyEnv: DEFAULT_NEON_API_KEY_ENV,
    neonApiTimeoutMs: DEFAULT_NEON_API_TIMEOUT_MS,
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
    else if (arg === "--pg-dump-status") options.pgDumpStatus = parseStatus(next(), arg);
    else if (arg === "--restore-drill-at") options.restoreDrillAt = parseDate(next(), arg);
    else if (arg === "--restore-drill-status") options.restoreDrillStatus = parseStatus(next(), arg);
    else if (arg === "--restore-drill-record") options.restoreDrillRecord = next();
    else if (arg === "--owner") options.owner = next();
    else if (arg === "--checked-at") options.checkedAt = parseDate(next(), arg);
    else if (arg === "--neon-api-base-url") options.neonApiBaseUrl = next();
    else if (arg === "--neon-api-key-env") options.neonApiKeyEnv = next();
    else if (arg === "--neon-api-timeout-ms") options.neonApiTimeoutMs = parsePositiveNumber(next(), arg);
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

function parseStatus(value, label) {
  const status = String(value ?? "").trim().toLowerCase();
  if (!KNOWN_STATUSES.has(status)) {
    throw new Error(`${label} must be one of: ${[...KNOWN_STATUSES].join(", ")}`);
  }
  return status;
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

/**
 * Read the PITR history window from Neon's control plane.
 *
 * `history_retention_seconds` is a control-plane property: it cannot be
 * observed from the data plane (SQL), so a measured value necessarily requires
 * a Neon API key. Accepting a caller-supplied number instead would mean the
 * actor being audited also supplies the number the gate checks, which is worth
 * nothing as evidence.
 *
 * Throws on every failure path. Callers must not fall back to an estimate:
 * "no evidence" is a correct outcome, "evidence that might be wrong" is not.
 */
async function measureHistoryRetention(options, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());

  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is unavailable; Node 18+ is required to measure Neon history retention");
  }

  const projectId = requireText(options, "projectId");
  const keyEnvName = options.neonApiKeyEnv || DEFAULT_NEON_API_KEY_ENV;
  const apiKey = String(env[keyEnvName] ?? "").trim();
  if (!apiKey) {
    throw new Error(
      `${keyEnvName} is required to measure Neon history retention. ` +
        "The gate refuses to emit evidence from a self-declared value.",
    );
  }

  const baseUrl = String(options.neonApiBaseUrl || DEFAULT_NEON_API_BASE_URL).replace(/\/+$/, "");
  const parsedBase = new URL(baseUrl);
  // The API key travels in a request header. Refuse plaintext to anywhere but
  // loopback (which only the test double uses).
  if (parsedBase.protocol !== "https:" && !LOOPBACK_HOSTS.has(parsedBase.hostname)) {
    throw new Error("neonApiBaseUrl must use https except for loopback addresses");
  }

  const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(options.neonApiTimeoutMs ?? DEFAULT_NEON_API_TIMEOUT_MS),
    });
  } catch (error) {
    // Never echo the request: the Authorization header is in it.
    throw new Error(`Neon API request failed: ${error.name || "Error"}`);
  }

  if (!response.ok) {
    // Status only. Response bodies from an auth failure can quote the token.
    throw new Error(`Neon API returned HTTP ${response.status} for the project lookup`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Neon API returned a non-JSON body for the project lookup");
  }

  const project = payload?.project;
  const seconds = Number(project?.history_retention_seconds);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Neon API response did not contain project.history_retention_seconds");
  }

  // Guard against measuring a different project than the one being backed up
  // (a mistyped id would otherwise produce a green gate for the wrong project).
  const measuredProjectId = String(project?.id ?? "").trim();
  if (measuredProjectId && measuredProjectId !== projectId) {
    throw new Error("Neon API returned a different project id than requested");
  }

  return {
    historyRetentionSecondsMeasured: seconds,
    historyRetentionMeasuredAt: iso(now()),
    historyRetentionProjectId: measuredProjectId || projectId,
    historyRetentionSource: "neon-api:GET /projects/{project_id}#history_retention_seconds",
  };
}

function buildEvidence(options, measurement) {
  const projectId = requireText(options, "projectId");
  const branch = requireText(options, "branch");
  const endpointHost = requireText(options, "endpointHost");
  const owner = requireText(options, "owner");

  const measuredSeconds = Number(measurement?.historyRetentionSecondsMeasured);
  if (!Number.isFinite(measuredSeconds) || measuredSeconds < 0) {
    throw new Error("a measured historyRetentionSeconds is required; refusing to write self-declared evidence");
  }
  // Derived, not declared: same field name and unit as before, but its value
  // now comes from the measurement instead of the caller.
  const historyWindowHours = measuredSeconds / 3600;

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

  // Measured where a measurement exists: reaching this point with
  // --pg-dump-file means artifactFromFile() found a regular, non-empty file,
  // which is exactly the fact the status was previously asserting on trust.
  // Restating it as a literal in the workflow would move the constant without
  // removing it, so the file path stays the source of truth.
  let pgDumpStatus;
  let pgDumpStatusSource;
  if (pgDumpSizeBytes !== undefined) {
    pgDumpStatus = "success";
    pgDumpStatusSource = "artifact-stat:regular-file,size>0";
    if (options.pgDumpStatus && options.pgDumpStatus !== pgDumpStatus) {
      throw new Error("--pg-dump-status contradicts the artifact measurement; refusing to record either");
    }
  } else {
    // No artifact to stat (external storage). The caller must state the
    // outcome, and the evidence records that it was stated rather than seen.
    if (!options.pgDumpStatus) {
      throw new Error("pgDumpStatus is required via --pg-dump-status unless --pg-dump-file is provided");
    }
    pgDumpStatus = options.pgDumpStatus;
    pgDumpStatusSource = "declared:--pg-dump-status";
  }

  // A restore drill is a human procedure: nothing in this workflow can observe
  // whether it happened. So the outcome stays declared -- but it must be
  // declared, and it must point at the committed record that backs it up.
  // Absence is now visible instead of being silently answered with "success".
  if (!options.restoreDrillStatus) {
    throw new Error("restoreDrillStatus is required via --restore-drill-status; there is no default outcome");
  }
  const restoreDrillRecord = requireText(options, "restoreDrillRecord");

  const evidence = {
    checkedAt: iso(options.checkedAt),
    projectId,
    branch,
    endpointHost,
    historyWindowHours,
    historyRetentionSecondsMeasured: measuredSeconds,
    historyRetentionMeasuredAt: measurement.historyRetentionMeasuredAt,
    historyRetentionProjectId: measurement.historyRetentionProjectId,
    historyRetentionSource: measurement.historyRetentionSource,
    lastPgDumpAt: iso(lastPgDumpAt),
    lastPgDumpStatus: pgDumpStatus,
    lastPgDumpStatusSource: pgDumpStatusSource,
    lastPgDumpArtifact: pgDumpArtifact.trim(),
    lastRestoreDrillAt: iso(options.restoreDrillAt),
    restoreDrillStatus: options.restoreDrillStatus,
    restoreDrillRecord,
    owner,
  };

  if (pgDumpSizeBytes !== undefined) evidence.pgDumpSizeBytes = pgDumpSizeBytes;

  // The declaration is recorded for drift detection only. It is never what the
  // gate judges: see check-neon-backup-evidence.js.
  const declaredHours = Number(options.historyWindowHours);
  if (Number.isFinite(declaredHours) && declaredHours > 0) {
    evidence.historyWindowHoursDeclared = declaredHours;
  }

  return evidence;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/tools/create-neon-backup-evidence.js --project-id <id> --branch <branch> --endpoint-host <host> --pg-dump-file <dump> --restore-drill-at <iso> --restore-drill-status <status> --restore-drill-record <ref> --owner <role>",
    "  node scripts/tools/create-neon-backup-evidence.js --project-id <id> --branch <branch> --endpoint-host <host> --pg-dump-artifact <artifact-id> --pg-dump-at <iso> --pg-dump-status <status> --restore-drill-at <iso> --restore-drill-status <status> --restore-drill-record <ref> --owner <role>",
    "",
    "Options:",
    `  --neon-api-key-env <name>      env var holding the Neon API key (default ${DEFAULT_NEON_API_KEY_ENV})`,
    `  --neon-api-base-url <url>      Neon control-plane base URL (default ${DEFAULT_NEON_API_BASE_URL})`,
    `  --neon-api-timeout-ms <ms>     request timeout (default ${DEFAULT_NEON_API_TIMEOUT_MS})`,
    "  --history-window-hours <h>     optional declaration, recorded for drift detection only",
    `  --restore-drill-status <s>     required, one of: ${[...KNOWN_STATUSES].join(", ")}`,
    "  --restore-drill-record <ref>   required, non-secret reference to the committed drill record",
    "  --pg-dump-status <s>           required only without --pg-dump-file; otherwise measured",
    "",
    "Notes:",
    "  The PITR history window is measured from Neon's control plane, not taken from the caller.",
    "  If the measurement fails the tool exits non-zero and writes no evidence: there is no estimated fallback.",
    "  The pg_dump status is derived from the artifact stat when --pg-dump-file is given.",
    "  The restore drill outcome has no default: a drill nobody ran must not be recorded as a success.",
    "  It never reads dump contents and emits non-secret JSON for release:check-neon-backup-evidence.",
  ].join("\n");
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    const measurement = await measureHistoryRetention(options);
    const evidence = buildEvidence(options, measurement);
    console.log(JSON.stringify(evidence, null, options.pretty ? 2 : 0));
  } catch (error) {
    console.error(`[neon-backup-evidence-create][error] ${redact(error.message)}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildEvidence, measureHistoryRetention, parseArgs, redact };
