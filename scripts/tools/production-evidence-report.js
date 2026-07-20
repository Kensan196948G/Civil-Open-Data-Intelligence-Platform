#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_URL = "https://civilopendata.mirai-dx-platform.com";
const PRODUCTION_HOSTNAME = "civilopendata.mirai-dx-platform.com";

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

function buildReport(env = process.env, root = process.cwd()) {
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

  const monitoringRows = MONITORING_ENV_KEYS.map((key) => [key, evidenceState(env[key])]);
  const backupRestoreRows = BACKUP_RESTORE_ENV_KEYS.map((key) => [key, evidenceState(env[key])]);
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
    ["Cloudflare Access evidence recorded", evidenceState(env.CODIP_CLOUDFLARE_ACCESS_EVIDENCE).startsWith("✅")],
    ["Monitoring contacts recorded", evidenceState(env.CODIP_MONITORING_CONTACTS).startsWith("✅")],
    ["Cloudflare alert policy recorded", evidenceState(env.CODIP_CLOUDFLARE_ALERT_POLICY).startsWith("✅")],
    ["Cloudflare logs evidence recorded", evidenceState(env.CODIP_CLOUDFLARE_LOGS_EVIDENCE).startsWith("✅")],
    ["Neon monitoring evidence recorded", evidenceState(env.CODIP_NEON_MONITORING_EVIDENCE).startsWith("✅")],
    ["Smoke monitoring schedule recorded", evidenceState(env.CODIP_SMOKE_MONITORING_SCHEDULE).startsWith("✅")],
    ["Rollback owner recorded", evidenceState(env.CODIP_ROLLBACK_OWNER).startsWith("✅")],
    ["Backup/restore evidence recorded", evidenceState(env.CODIP_BACKUP_RESTORE_EVIDENCE).startsWith("✅")],
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

module.exports = { buildReport };
