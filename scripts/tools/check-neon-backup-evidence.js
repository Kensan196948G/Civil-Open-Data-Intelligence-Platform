#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MIN_HISTORY_WINDOW_HOURS = 24;
const DEFAULT_MAX_PG_DUMP_AGE_HOURS = 24;
const DEFAULT_MAX_RESTORE_DRILL_AGE_DAYS = 30;
const DEFAULT_MAX_HISTORY_MEASUREMENT_AGE_HOURS = 24;

// The one document that counts as a restore drill record.
//
// Resolving the reference proves it leads somewhere; it does not prove it leads
// *here*. Without this constant the gate accepts any file in the checkout --
// package.json satisfied it -- so "a drill was recorded" degraded to "a file was
// named". Deliberately not overridable from the command line: a flag that lets
// the caller nominate the expected document would hand back exactly the freedom
// this constant removes.
//
// A rename or move of the ledger makes every reference fail here rather than
// silently pass, which is the direction to fail in. The pairing test in
// tests/unit/neon-backup-evidence.test.ts asserts this path exists in the real
// tree, so a move surfaces in the test suite instead of in a 03:17 JST backup run.
const RESTORE_DRILL_LEDGER = "docs/runbooks/restore-drill-record.md";

const REQUIRED_STRING_FIELDS = [
  "projectId",
  "branch",
  "endpointHost",
  "lastPgDumpStatus",
  "lastPgDumpArtifact",
  "restoreDrillStatus",
  "owner",
  "historyRetentionSource",
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
    maxHistoryMeasurementAgeHours: DEFAULT_MAX_HISTORY_MEASUREMENT_AGE_HOURS,
    // restoreDrillRecord is a repository-relative path, so it can only be
    // resolved against a checkout. The workflow runs this tool from the
    // checkout root; tests point it at a fixture tree instead.
    repoRoot: process.cwd(),
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
    else if (arg === "--repo-root") options.repoRoot = next();
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

// Approximates the slug GitHub derives from a rendered heading: lower-case the
// text, drop everything that is not a letter, digit, hyphen, underscore or
// space, then turn spaces into hyphens. Repeats take a numeric suffix.
//
// The leading whitespace is deliberately *not* re-trimmed after stripping.
// GitHub does the same, which is why an emoji-prefixed heading such as
// "# 🗄️ 復旧訓練" yields "-復旧訓練" with a leading hyphen. Trimming here would
// silently reject an anchor that resolves in the rendered document.
function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .replace(/ /g, "-");
}

// Reduces a raw heading line to the text a reader sees, because that -- not
// the markdown source -- is what the slug is derived from.
function renderedHeadingText(markdown) {
  return markdown
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_)/g, "");
}

// Every anchor the referenced document actually offers.
//
// Two sources are honoured because both resolve in GitHub's renderer: slugs
// generated from headings, and explicit <a id>/<a name> targets. The explicit
// form matters here -- it is the only way to give an append-only table row its
// own anchor without restructuring the table into headings.
function collectAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  let fenceMarker = "";

  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const base = slugifyHeading(renderedHeadingText(heading[2]));
      if (base) {
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        anchors.add(count === 0 ? base : `${base}-${count}`);
      }
    }

    for (const match of line.matchAll(/<a\s+[^>]*?(?:id|name)\s*=\s*["']([^"']+)["']/gi)) {
      anchors.add(match[1].trim().toLowerCase());
    }
  }

  return anchors;
}

function decodeAnchor(anchor) {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

// Judges `path/to/file.md#anchor` against a checkout.
//
// A presence-only test (`length > 0`) accepts a reference that resolves to
// nothing, which is how docs/runbooks/restore-drill-record.md#2026-08-12 came
// to be recorded as evidence: the file exists, the anchor does not, and no
// check could tell the difference.
//
// An anchor-less reference is accepted by choice, not by necessity. An earlier
// version of this comment claimed the ledger's shape could not support per-row
// anchors -- that requiring one would force the append-only table into a
// date-heading layout and so rewrite rows the ledger forbids rewriting. That is
// false, and collectAnchors below is what falsifies it: an explicit
// `<a id="...">` inside a table cell resolves, and adding one to each *new* row
// leaves every past row untouched. The honest statement is that anchors are
// available but not yet worth the recording burden they place on whoever runs a
// drill, so they are not required today. Recording an unexercised option as an
// impossibility is worse than the missing check itself: it retires the question.
//
// When an anchor *is* supplied it must resolve, because an unresolvable one is a
// false claim of precision rather than a missing convenience.
function resolveDocumentReference(reference, repoRoot, expectedPath) {
  const raw = String(reference ?? "").trim();
  if (!raw) return { ok: false, detail: "(not recorded)" };

  const hashIndex = raw.indexOf("#");
  const relativePath = (hashIndex === -1 ? raw : raw.slice(0, hashIndex)).trim();
  const anchor = hashIndex === -1 ? "" : raw.slice(hashIndex + 1).trim();

  if (!relativePath) return { ok: false, detail: `${safeValue(raw)} has no file path` };
  if (relativePath.includes("\0")) return { ok: false, detail: `${safeValue(relativePath)} is not a valid path` };
  if (path.isAbsolute(relativePath)) {
    return { ok: false, detail: `${safeValue(relativePath)} is absolute; the reference must be repository-relative` };
  }

  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { ok: false, detail: `${safeValue(relativePath)} escapes the repository root` };
  }

  // Compared after resolution rather than as a raw string so that "./a/b.md",
  // "a//b.md" and "a/x/../b.md" are judged as the one path they name.
  const normalized = path.relative(root, resolved).split(path.sep).join("/");
  if (normalized !== expectedPath) {
    return {
      ok: false,
      detail: `${safeValue(normalized)} is not the restore drill ledger (expected ${safeValue(expectedPath)})`,
    };
  }

  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    return { ok: false, detail: `${safeValue(relativePath)} does not exist in the repository` };
  }
  if (!stats.isFile()) return { ok: false, detail: `${safeValue(relativePath)} is not a regular file` };

  if (!anchor) {
    return { ok: true, detail: `${safeValue(relativePath)} exists (no anchor supplied)` };
  }

  let contents;
  try {
    contents = fs.readFileSync(resolved, "utf8");
  } catch {
    return { ok: false, detail: `${safeValue(relativePath)} could not be read` };
  }

  const anchors = collectAnchors(contents);
  const wanted = decodeAnchor(anchor).toLowerCase();
  if (!anchors.has(wanted)) {
    return {
      ok: false,
      detail: `${safeValue(relativePath)} exists but has no anchor #${safeValue(anchor)} (${anchors.size} anchors found)`,
    };
  }

  return { ok: true, detail: `${safeValue(relativePath)}#${safeValue(anchor)} resolves` };
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
  // without this, so failing here would only catch hand-forged documents.
  // It is surfaced so a reader of the report can tell a measured status from
  // a declared one without opening the JSON.
  note(
    "lastPgDumpStatus was measured, not declared",
    String(evidence.lastPgDumpStatusSource ?? "").startsWith("artifact-stat:"),
    safeValue(evidence.lastPgDumpStatusSource ?? "(not recorded)"),
  );

  // Gating, unlike the note above, and the difference is not a change of
  // appetite. The generator's guarantee covers *presence*: it will not emit
  // evidence with an empty restoreDrillRecord. It cannot cover *resolvability*,
  // because it never opens the document it is handed a path to. The value
  // measured in production on 2026-08-12 proves the gap -- the file existed,
  // the anchor did not, and the presence-only note reported ✅ regardless.
  // Nothing upstream catches that, so it has to be caught here.
  //
  // Resolvability alone still under-checks: it asks whether the reference leads
  // somewhere, not whether it leads to the drill ledger. Passing the expected
  // path explicitly keeps that second question at the call site, where it is
  // visible, instead of buried as a default inside the resolver.
  const drillRecord = resolveDocumentReference(
    evidence.restoreDrillRecord,
    options.repoRoot,
    RESTORE_DRILL_LEDGER,
  );
  add("restoreDrillRecord resolves", drillRecord.ok, drillRecord.detail);

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
    "Options:",
    "  --repo-root <dir>  Checkout to resolve restoreDrillRecord against (default: cwd).",
    "",
    "Notes:",
    "  The PITR window is judged on historyRetentionSecondsMeasured (measured from the Neon API).",
    "  A missing measurement fails the gate; the self-declared historyWindowHours is never used to pass it.",
    `  restoreDrillRecord must name ${RESTORE_DRILL_LEDGER}, which must exist in the checkout; an`,
    "  anchor, when supplied, must resolve to a heading slug or an explicit <a id>/<a name> target",
    "  in that file. Any other path is rejected even when it exists.",
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
