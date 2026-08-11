#!/usr/bin/env node
// Full-dependency audit gate with an explicit, expiring allowlist.
//
// The production graph gate (`npm audit --omit=dev`) stays zero-tolerance in CI.
// This gate covers the full graph (dev included): every moderate+ advisory must
// either be absent or be covered by an unexpired allowlist entry that names the
// reason, tracking issue, owner, and expiry. Unknown advisories, expired
// entries, and audit execution failures all fail the gate.
//
// Usage:
//   node scripts/tools/check-dependency-audit.js            # runs `npm audit --json`
//   node scripts/tools/check-dependency-audit.js --input f  # evaluate a saved report (tests)

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

// Issue #108 の2件 (GHSA-5p4m-2wfm-xmqj / js-yaml, GHSA-2v37-7h3g-55p8 / nanoid)
// は allowlist ではなく実アップグレードで解消済みのため、エントリを保持しない。
// 再燃した場合は `unallowlisted` として即 FAIL させたいので、退役エントリを
// 「念のため」残さない。経緯は docs/security/dependency-advisory-status.md 参照。
const ALLOWLIST = [
  {
    ghsa: "GHSA-mh99-v99m-4gvg",
    severity: "high",
    scope: "devDependencies (eslint / @opennextjs build chain)",
    reason:
      "brace-expansion OOM-DoS。修正がeslint 10系等のsemver-majorにしか存在せず、lint/build時ツールのため本番Workerバンドルへは同梱されない",
    tracking: "Issue #82",
    owner: "Kensan196948G",
    expires: "2026-09-30T00:00:00Z",
  },
];

const BLOCKING_SEVERITIES = new Set(["moderate", "high", "critical"]);

function collectAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via === "object" && via !== null && typeof via.url === "string") {
        const ghsa = via.url.split("/").pop();
        if (ghsa && !advisories.has(ghsa)) {
          advisories.set(ghsa, {
            severity: via.severity,
            pkg: via.name,
            title: via.title ?? "",
          });
        }
      }
    }
  }
  return advisories;
}

function evaluateAudit(report, allowlist, nowIso) {
  const now = Date.parse(nowIso);
  const errors = [];
  const allowed = [];

  // A syntactically valid report can still carry a top-level execution error
  // (e.g. registry unreachable). Never treat that as a clean audit.
  if (report.error) {
    const code = report.error.code ?? "unknown";
    const summary = report.error.summary ?? "no summary";
    errors.push(`npm audit failed: ${code} — ${summary}`);
    return { errors, allowed };
  }

  // Stale-allowlist hygiene: expired entries fail even while their advisory is
  // not currently detected, so acceptances cannot silently outlive their review.
  for (const entry of allowlist) {
    const expiresAt = Date.parse(entry.expires);
    if (!Number.isFinite(expiresAt) || !(now < expiresAt)) {
      errors.push(
        `allowlist entry for ${entry.ghsa} expired at ${entry.expires} — re-evaluate via ${entry.tracking ?? "tracking issue"} (owner: ${entry.owner ?? "unassigned"})`,
      );
    }
  }
  if (errors.length > 0) {
    return { errors, allowed };
  }

  const advisories = collectAdvisories(report);

  if (advisories.size === 0) {
    // Defensive: never treat an unparseable report as clean.
    const counts = report.metadata?.vulnerabilities ?? {};
    const total = (counts.moderate ?? 0) + (counts.high ?? 0) + (counts.critical ?? 0);
    if (total > 0) {
      errors.push(
        `audit reports ${total} moderate+ vulnerabilities but no advisory details could be parsed`,
      );
    }
    return { errors, allowed };
  }

  for (const [ghsa, meta] of advisories) {
    if (!BLOCKING_SEVERITIES.has(meta.severity)) continue;
    const entry = allowlist.find((candidate) => candidate.ghsa === ghsa);
    if (!entry) {
      errors.push(`unallowlisted ${meta.severity} advisory ${ghsa} (${meta.pkg}: ${meta.title})`);
      continue;
    }
    // Expiry was validated for every entry above, so a match here is accepted.
    allowed.push(`${ghsa} (${meta.severity}, ${entry.scope}) until ${entry.expires} — ${entry.tracking}`);
  }

  return { errors, allowed };
}

function loadReport(inputPath) {
  if (inputPath) {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  }
  const result = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`npm audit failed to run: ${result.error.message}`);
  }
  if (!result.stdout) {
    throw new Error(`npm audit produced no output (status=${result.status})`);
  }
  return JSON.parse(result.stdout);
}

function parseArgs(argv) {
  const options = { input: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input") {
      options.input = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = loadReport(options.input);
    const { errors, allowed } = evaluateAudit(report, ALLOWLIST, new Date().toISOString());
    for (const line of allowed) {
      console.log(`[dependency-audit] allowlisted: ${line}`);
    }
    if (errors.length > 0) {
      for (const line of errors) {
        console.error(`[dependency-audit] FAIL: ${line}`);
      }
      process.exit(1);
    }
    console.log("[dependency-audit] OK");
  } catch (error) {
    console.error(`[dependency-audit] FAIL: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ALLOWLIST, collectAdvisories, evaluateAudit, parseArgs };
