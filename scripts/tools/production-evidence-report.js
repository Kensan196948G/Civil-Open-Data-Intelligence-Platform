#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_URL = "https://odip.mirai-dx-platform.com";
const PRODUCTION_HOSTNAME = "odip.mirai-dx-platform.com";

const TARGETS = {
  production: {
    label: "Production",
    wranglerEnv: "production",
    expectedUrl: PRODUCTION_URL,
    hostname: PRODUCTION_HOSTNAME,
    requiresCustomDomain: true,
  },
  staging: {
    label: "Staging",
    wranglerEnv: "preview",
    expectedUrl: null,
    hostname: null,
    requiresCustomDomain: false,
  },
};

const SECRET_ENV_KEYS = [
  "DATABASE_URL",
  "CODIP_MIGRATION_DATABASE_URL",
  "CODIP_ADMIN_TOKEN",
  "CODIP_TRUST_PROXY_SECRET",
];

const PUBLIC_ENV_KEYS = [
  "CODIP_DEPLOY_TARGET",
  "CODIP_BASE_URL",
  "CODIP_HYPERDRIVE_BINDING",
  "CODIP_NEON_BRANCH",
  "CODIP_DISABLE_TOKEN_AUTH",
  "CODIP_TRUST_PROXY_AUTH",
  "CODIP_ADMIN_EMAILS",
  "CODIP_ADMIN_EMAIL_DOMAINS",
];

const MONITORING_ENV_KEYS = [
  "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
  "CODIP_MONITORING_CONTACTS",
  "CODIP_CLOUDFLARE_ALERT_POLICY",
  "CODIP_CLOUDFLARE_LOGS_EVIDENCE",
  "CODIP_NEON_MONITORING_EVIDENCE",
  "CODIP_SMOKE_MONITORING_SCHEDULE",
  "CODIP_ROLLBACK_OWNER",
];

const BACKUP_RESTORE_ENV_KEYS = [
  "CODIP_BACKUP_RESTORE_EVIDENCE",
];

const PLACEHOLDER_PATTERNS = [
  /example/i,
  /replace/i,
  /change[-_]?this/i,
  /placeholder/i,
  /dummy/i,
  /ci[-_]/i,
  /production-admin-token/i,
  /preview-admin-token/i,
];

// --- Evidence format requirements (Issue #128) -----------------------------
//
// The eight evidence values below arrive from GitHub Variables, which the
// person running the deploy can edit. Until Issue #128 the only tests were
// "not empty" and "not placeholder-like", so the two characters `ok` satisfied
// all eight readiness checks and the run recorded a monitoring posture that
// nobody had verified.
//
// The expected *shape* therefore has to live here, in the checker, not beside
// the value: an expectation the supplier can rewrite is not an expectation.
// This mirrors PRODUCTION_BASE_HOSTNAME in validate-production-target-env.js:99-101,
// where the value comes from `vars.*` but the expected hostname is pinned in code.
//
// These checks cannot prove that an alert policy exists or that a contact is
// reachable — that needs the Cloudflare API and is out of scope here. They
// prove only that the recorded evidence has the shape of a real answer, which
// is what makes the difference between a claim and a token gesture.

const EVIDENCE_MIN_DATE_MS = Date.parse("2025-01-01T00:00:00Z");
const EVIDENCE_FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const HOSTNAME_PATTERN = /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONTACT_HANDLE_PATTERN = /^(?:#|team:|oncall:)[a-z0-9][a-z0-9._-]{2,}$/i;
const CRON_FIELD_PATTERN = /^(\*|\d+|\d+-\d+)(\/\d+)?(,(\*|\d+|\d+-\d+)(\/\d+)?)*$/;
const SCHEDULE_KEYWORDS = ["hourly", "daily", "weekly", "monthly", "per-release"];
const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{3,}$/;
// Same vocabulary as create-neon-backup-evidence.js, so a drill outcome means
// the same thing on both sides of the release process.
const DRILL_OUTCOMES = ["success", "failed", "partial", "not-run", "blocked"];
// A restore drill that did not fully succeed must not satisfy the deploy
// evidence gate. `partial` is a recorded outcome but it is *not* a passing one
// (docs/runbooks/restore-drill-record.md §1.2): only `success` may pass.
const DRILL_PASSING_OUTCOMES = ["success"];

function requireIsoDate(value, now) {
  const matches = value.match(ISO_DATE_PATTERN) ?? [];
  if (matches.length === 0) return ["needs an ISO 8601 date (YYYY-MM-DD or a full timestamp)"];

  const upperBound = now.getTime() + EVIDENCE_FUTURE_TOLERANCE_MS;
  const plausible = matches.some((match) => {
    const parsed = Date.parse(match.replace(" ", "T"));
    return Number.isFinite(parsed) && parsed >= EVIDENCE_MIN_DATE_MS && parsed <= upperBound;
  });
  // A date outside the range is how a typo ("2016-..."), a copied sample, or a
  // fabricated future confirmation shows up.
  return plausible ? [] : ["contains no date within the plausible range (2025-01-01 .. today)"];
}

function requireHostname(value) {
  return HOSTNAME_PATTERN.test(value) ? [] : ["needs the application hostname"];
}

function requireOneOf(value, vocabulary, label) {
  // Word boundaries matter here: a plain substring test would accept
  // "unsuccessful" as the outcome "success", i.e. read a failed drill as a
  // passed one.
  const found = vocabulary.some((word) =>
    new RegExp(`(^|[^a-z-])${word}([^a-z-]|$)`, "i").test(value),
  );
  return found ? [] : [`needs ${label} (one of: ${vocabulary.join(", ")})`];
}

function isCronExpression(value) {
  const fields = value.split(/\s+/);
  return fields.length === 5 && fields.every((field) => CRON_FIELD_PATTERN.test(field));
}

const EVIDENCE_FORMATS = {
  CODIP_CLOUDFLARE_ACCESS_EVIDENCE: {
    expectation:
      "application hostname + policy name + verification date (ISO 8601). Example: `odip.mirai-dx-platform.com policy=codip-admins verified=2026-07-19`",
    minLength: 24,
    validate: (value, now) => [...requireHostname(value), ...requireIsoDate(value, now)],
  },
  CODIP_MONITORING_CONTACTS: {
    expectation:
      "comma-separated contacts, each an email address, `#channel`, `team:<name>`, or `oncall:<name>`",
    minLength: 6,
    validate: (value) => {
      const items = value.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) return ["needs at least one contact"];
      const unmatched = items.filter(
        (item) => !EMAIL_PATTERN.test(item) && !CONTACT_HANDLE_PATTERN.test(item),
      );
      // The entries themselves are contact details, so report the count only.
      return unmatched.length === 0
        ? []
        : [`${unmatched.length} of ${items.length} contacts are neither an email nor a #/team:/oncall: handle`];
    },
  },
  CODIP_CLOUDFLARE_ALERT_POLICY: {
    expectation:
      "policy name + notification test date (ISO 8601). Example: `codip-production-p1 notification-test=2026-07-19`",
    minLength: 20,
    validate: (value, now) => requireIsoDate(value, now),
  },
  CODIP_CLOUDFLARE_LOGS_EVIDENCE: {
    expectation: "log query result summary + query date (ISO 8601)",
    minLength: 20,
    validate: (value, now) => requireIsoDate(value, now),
  },
  CODIP_NEON_MONITORING_EVIDENCE: {
    expectation: "Neon branch name + check date (ISO 8601)",
    minLength: 20,
    validate: (value, now) => requireIsoDate(value, now),
  },
  CODIP_SMOKE_MONITORING_SCHEDULE: {
    expectation: `a 5-field cron expression (e.g. \`*/15 * * * *\`) or one of: ${SCHEDULE_KEYWORDS.join(", ")}`,
    minLength: 5,
    validate: (value) => {
      if (isCronExpression(value)) return [];
      if (SCHEDULE_KEYWORDS.includes(value.toLowerCase())) return [];
      // Free text such as "*/5 read-only smoke" reads like a schedule but names
      // no interval a machine or a stand-in operator can act on.
      return ["must be a 5-field cron expression or a defined schedule keyword, not free text"];
    },
  },
  CODIP_ROLLBACK_OWNER: {
    expectation:
      "a single identifier with no whitespace, 4+ characters (account name, team handle, or email)",
    minLength: 4,
    validate: (value) =>
      OWNER_PATTERN.test(value)
        ? []
        : ["must be one whitespace-free identifier of 4+ characters, not a sentence"],
  },
  CODIP_BACKUP_RESTORE_EVIDENCE: {
    expectation: `PITR window + drill date (ISO 8601) + drill outcome (${DRILL_OUTCOMES.join(", ")}; passing requires ${DRILL_PASSING_OUTCOMES.join("/")})`,
    minLength: 24,
    validate: (value, now) => {
      const problems = [...requireIsoDate(value, now)];
      const found = DRILL_OUTCOMES.some((word) =>
        new RegExp(`(^|[^a-z-])${word}([^a-z-]|$)`, "i").test(value),
      );
      if (!found) {
        problems.push(`needs a drill outcome (one of: ${DRILL_OUTCOMES.join(", ")})`);
        return problems;
      }
      const passing = DRILL_PASSING_OUTCOMES.some((word) =>
        new RegExp(`(^|[^a-z-])${word}([^a-z-]|$)`, "i").test(value),
      );
      if (!passing) {
        problems.push(
          `drill outcome is not passing: only ${DRILL_PASSING_OUTCOMES.join("/")} satisfies the deploy gate (recorded non-passing outcomes stay visible in the report)`,
        );
      }
      return problems;
    },
  },
};

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function resolveTarget(env) {
  const targetName = env.CODIP_DEPLOY_TARGET?.trim() || "production";
  return TARGETS[targetName] ?? {
    label: "Unknown target",
    wranglerEnv: "production",
    expectedUrl: PRODUCTION_URL,
    hostname: PRODUCTION_HOSTNAME,
    requiresCustomDomain: true,
  };
}

function isRealHttpsTarget(value) {
  const parsed = parseUrl(value?.trim() ?? "");
  if (!parsed || parsed.protocol !== "https:") return false;
  if (["localhost", "127.0.0.1", "::1", "example.com"].includes(parsed.hostname)) return false;
  return !hasPlaceholder(value);
}

function isEnabled(value) {
  return value?.trim().toLowerCase() === "true";
}

function statusIcon(ok) {
  return ok ? "✅" : "⚠️";
}

function valueState(value, { secret = false } = {}) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "⚠️ unset";
  if (hasPlaceholder(trimmed)) return "⚠️ placeholder-like";
  return secret ? "✅ set (redacted)" : `✅ ${trimmed}`;
}

function evidenceState(value) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "⚠️ unset";
  if (hasPlaceholder(trimmed)) return "⚠️ placeholder-like";
  return "✅ set (recorded)";
}

// evidenceState above answers "is there a string here at all". It is kept as a
// separate function because presence and shape fail for different reasons and
// the report should say which. Only this function is allowed to produce the ✅
// that a readiness check reads.
function evidenceFormatState(key, value, now) {
  const presence = evidenceState(value);
  if (!presence.startsWith("✅")) return presence;

  const spec = EVIDENCE_FORMATS[key];
  // A key with no spec used to fall through and return the presence verdict,
  // which contradicted the paragraph above: presence alone reached a readiness
  // check. The failure mode is adding a key to the report tables and forgetting
  // the spec -- the extra row then reads as more checking while being less.
  // Refuse instead. The name is a key, never a value, so it is safe to print.
  if (!spec) return `⚠️ no format spec registered for ${key}`;

  const trimmed = value.trim();
  const problems = [
    ...(trimmed.length < spec.minLength ? [`too short (needs ${spec.minLength}+ characters)`] : []),
    ...spec.validate(trimmed, now),
  ];
  // Never echo the value: these carry contact details and operational notes.
  return problems.length === 0
    ? "✅ set (recorded, format checked)"
    : `⚠️ ${problems.join("; ")}`;
}

function secretUrlState(value) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "⚠️ unset";
  if (hasPlaceholder(trimmed)) return "⚠️ placeholder-like (redacted)";

  const parsed = parseUrl(trimmed);
  const sslMode = parsed?.searchParams.get("sslmode")?.toLowerCase() ?? "";
  const postgres = trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://");
  const ssl = sslMode === "require" || sslMode === "verify-full";

  return `${statusIcon(postgres && ssl)} set (redacted, postgres=${postgres ? "yes" : "no"}, ssl=${
    ssl ? sslMode : "missing"
  })`;
}

function inspectWrangler(root, target) {
  const wranglerPath = path.join(root, "wrangler.jsonc");
  const result = {
    rows: [],
    checks: [],
  };
  if (!fs.existsSync(wranglerPath)) {
    result.rows.push(["wrangler.jsonc", "⚠️ missing"]);
    result.checks.push(["Wrangler config exists", false]);
    return result;
  }

  let wrangler;
  try {
    wrangler = JSON.parse(stripJsonComments(fs.readFileSync(wranglerPath, "utf8")));
  } catch {
    result.rows.push(["wrangler.jsonc", "⚠️ invalid JSONC"]);
    result.checks.push(["Wrangler config parseable", false]);
    return result;
  }
  const targetEnv = wrangler.env?.[target.wranglerEnv];
  const targetRoute = target.hostname
    ? targetEnv?.routes?.find(
        (route) => route?.pattern === target.hostname || route?.pattern === `${target.hostname}/*`,
      )
    : null;
  const targetHyperdrive = Array.isArray(targetEnv?.hyperdrive) ? targetEnv.hyperdrive : [];
  const hyperdriveId = targetHyperdrive.find((binding) => binding?.binding === "HYPERDRIVE")?.id ?? targetHyperdrive[0]?.id ?? "";
  const checks = [
    [`${target.wranglerEnv} env`, `Wrangler ${target.wranglerEnv} env configured`, Boolean(targetEnv), "configured", "missing"],
    [
      "observability",
      "Wrangler observability enabled",
      wrangler.observability?.enabled === true,
      "enabled",
      "not enabled",
    ],
    [
      "hyperdrive id",
      `Wrangler ${target.wranglerEnv} Hyperdrive id resolved`,
      Boolean(hyperdriveId) && !hasPlaceholder(hyperdriveId),
      "no obvious placeholder",
      "missing or placeholder present",
    ],
  ];

  if (target.requiresCustomDomain) {
    checks.splice(
      1,
      0,
      ["production route", "Wrangler production route configured", Boolean(targetRoute), target.hostname, "production host missing"],
      [
        "route binding",
        "Wrangler production route binding resolved",
        targetRoute?.custom_domain === true || Boolean(targetRoute?.zone_name),
        "custom_domain or zone route",
        "custom_domain/zone_name missing",
      ],
      ["workers_dev", "Wrangler workers_dev disabled", targetEnv?.workers_dev === false, "false", "not false"],
    );
  }

  for (const [rowLabel, checkLabel, ok, okText, warningText] of checks) {
    result.rows.push([rowLabel, ok ? `✅ ${okText}` : `⚠️ ${warningText}`]);
    result.checks.push([checkLabel, ok]);
  }
  return result;
}

function buildReport(env = process.env, root = process.cwd(), now = new Date()) {
  const rows = [];
  const target = resolveTarget(env);
  const targetUrl = env.CODIP_BASE_URL?.trim() || target.expectedUrl || "";

  for (const key of PUBLIC_ENV_KEYS) {
    rows.push([key, valueState(env[key])]);
  }
  for (const key of SECRET_ENV_KEYS) {
    const state = key.endsWith("DATABASE_URL") || key === "DATABASE_URL" ? secretUrlState(env[key]) : valueState(env[key], { secret: true });
    rows.push([key, state]);
  }

  const evidenceOk = (key) => evidenceFormatState(key, env[key], now).startsWith("✅");
  const monitoringRows = MONITORING_ENV_KEYS.map((key) => [key, evidenceFormatState(key, env[key], now)]);
  const backupRestoreRows = BACKUP_RESTORE_ENV_KEYS.map((key) => [
    key,
    evidenceFormatState(key, env[key], now),
  ]);
  const wranglerEvidence = inspectWrangler(root, target);

  const readinessChecks = [
    ["Deploy target is production or staging", ["production", "staging"].includes(env.CODIP_DEPLOY_TARGET ?? "")],
    [
      target.expectedUrl ? "Production URL fixed" : "Target URL is a real HTTPS URL",
      target.expectedUrl ? env.CODIP_BASE_URL === target.expectedUrl : isRealHttpsTarget(env.CODIP_BASE_URL),
    ],
    ["Hyperdrive binding named", Boolean(env.CODIP_HYPERDRIVE_BINDING?.trim()) && !hasPlaceholder(env.CODIP_HYPERDRIVE_BINDING)],
    ["Neon branch named", Boolean(env.CODIP_NEON_BRANCH?.trim()) && !hasPlaceholder(env.CODIP_NEON_BRANCH)],
    ["Runtime DB URL set", Boolean(env.DATABASE_URL?.trim()) && secretUrlState(env.DATABASE_URL).startsWith("✅")],
    [
      "Migration DB URL set",
      Boolean(env.CODIP_MIGRATION_DATABASE_URL?.trim()) && secretUrlState(env.CODIP_MIGRATION_DATABASE_URL).startsWith("✅"),
    ],
    ["Cloudflare Access evidence recorded", evidenceOk("CODIP_CLOUDFLARE_ACCESS_EVIDENCE")],
    ["Monitoring contacts recorded", evidenceOk("CODIP_MONITORING_CONTACTS")],
    ["Cloudflare alert policy recorded", evidenceOk("CODIP_CLOUDFLARE_ALERT_POLICY")],
    ["Cloudflare logs evidence recorded", evidenceOk("CODIP_CLOUDFLARE_LOGS_EVIDENCE")],
    ["Neon monitoring evidence recorded", evidenceOk("CODIP_NEON_MONITORING_EVIDENCE")],
    ["Smoke monitoring schedule recorded", evidenceOk("CODIP_SMOKE_MONITORING_SCHEDULE")],
    ["Rollback owner recorded", evidenceOk("CODIP_ROLLBACK_OWNER")],
    ["Backup/restore evidence recorded", evidenceOk("CODIP_BACKUP_RESTORE_EVIDENCE")],
    ...wranglerEvidence.checks,
  ];

  if (env.CODIP_DEPLOY_TARGET === "production") {
    readinessChecks.push(
      ["Production direct token auth disabled", isEnabled(env.CODIP_DISABLE_TOKEN_AUTH)],
      ["Production proxy auth enabled", isEnabled(env.CODIP_TRUST_PROXY_AUTH)],
      [
        "Production proxy secret set",
        Boolean(env.CODIP_TRUST_PROXY_SECRET?.trim()) && !hasPlaceholder(env.CODIP_TRUST_PROXY_SECRET),
      ],
      [
        "Production admin allowlist recorded",
        Boolean(env.CODIP_ADMIN_EMAILS?.trim() || env.CODIP_ADMIN_EMAIL_DOMAINS?.trim()) &&
          !hasPlaceholder(`${env.CODIP_ADMIN_EMAILS ?? ""}${env.CODIP_ADMIN_EMAIL_DOMAINS ?? ""}`),
      ],
    );
  }

  const ready = readinessChecks.every(([, ok]) => ok);

  const lines = [
    "# Cloudflare / Neon Target Evidence",
    "",
    `- Deploy target: \`${env.CODIP_DEPLOY_TARGET ?? ""}\``,
    `- Target URL: \`${targetUrl}\``,
    `- Overall: ${ready ? "✅ evidence inputs look ready" : "⚠️ evidence inputs incomplete"}`,
    "",
    "## Environment Evidence",
    "",
    "| Key | State |",
    "| --- | --- |",
    ...rows.map(([key, state]) => `| \`${key}\` | ${state} |`),
    "",
    "## Monitoring Evidence",
    "",
    "| Key | State |",
    "| --- | --- |",
    ...monitoringRows.map(([key, state]) => `| \`${key}\` | ${state} |`),
    "",
    "## Backup / Restore Evidence",
    "",
    "| Key | State |",
    "| --- | --- |",
    ...backupRestoreRows.map(([key, state]) => `| \`${key}\` | ${state} |`),
    "",
    "## Wrangler Evidence",
    "",
    "| Check | State |",
    "| --- | --- |",
    ...wranglerEvidence.rows.map(([key, state]) => `| ${key} | ${state} |`),
    "",
    "## Readiness Checks",
    "",
    "| Check | State |",
    "| --- | --- |",
    ...readinessChecks.map(([key, ok]) => `| ${key} | ${statusIcon(ok)} |`),
    "",
    "## Evidence Format Requirements",
    "",
    "> Defined in `scripts/tools/production-evidence-report.js` (`EVIDENCE_FORMATS`), not in the",
    "> GitHub Variables that supply the values. See `docs/security/production-evidence-format.md`.",
    "",
    "| Key | Expected shape |",
    "| --- | --- |",
    ...Object.entries(EVIDENCE_FORMATS).map(([key, spec]) => `| \`${key}\` | ${spec.expectation} |`),
    "",
    "## Required External Evidence",
    "",
    "| Item | Evidence to paste into release notes |",
    "| --- | --- |",
    "| Cloudflare deploy | `wrangler deployments list --env production` result |",
    "| Cloudflare Access | application domain, policy name, allowlist summary, proxy secret configured evidence |",
    "| Workers logs | error count / request sample / trace query timestamp |",
    "| Cloudflare alerts | alert policy name, threshold summary, notification test timestamp |",
    "| Hyperdrive | binding name and config id, with connection string omitted |",
    "| Neon | branch name, migration status, PostGIS capability, capacity / connection / slow query summary |",
    "| Backup / restore | Neon PITR window, restore rehearsal or rollback drill result, and restore verification owner |",
    "| Monitoring smoke | schedule, last success timestamp, next owner |",
    `| Smoke | \`npm run release:smoke -- --read-only --base-url ${targetUrl || "<target-url>"}\` result |`,
    "",
  ];

  return { ready, text: lines.join("\n") };
}

function main() {
  const strict = process.argv.includes("--strict");
  const { ready, text } = buildReport();
  console.log(text);
  if (strict && !ready) process.exit(1);
}

if (require.main === module) main();

// evidenceState is exported so the audit-scenario tests can observe the
// pre-#128 presence-only judgement directly. They used to reach it by handing
// evidenceFormatState a key with no spec, which made a probe out of a defect:
// hardening that fallthrough would have broken the probe.
module.exports = { buildReport, evidenceState, evidenceFormatState, EVIDENCE_FORMATS };
