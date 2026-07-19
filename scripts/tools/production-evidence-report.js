#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_URL = "https://civilopendata.mirai-dx-platform.com";
const PRODUCTION_HOSTNAME = "civilopendata.mirai-dx-platform.com";

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

const PLACEHOLDER_PATTERNS = [
  /example/i,
  /change[-_]?this/i,
  /placeholder/i,
  /dummy/i,
  /ci[-_]/i,
  /production-admin-token/i,
  /preview-admin-token/i,
];

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

function statusIcon(ok) {
  return ok ? "✅" : "⚠️";
}

function valueState(value, { secret = false } = {}) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "⚠️ unset";
  if (hasPlaceholder(trimmed)) return "⚠️ placeholder-like";
  return secret ? "✅ set (redacted)" : `✅ ${trimmed}`;
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

function inspectWrangler(root) {
  const wranglerPath = path.join(root, "wrangler.jsonc");
  const result = [];
  if (!fs.existsSync(wranglerPath)) {
    result.push(["wrangler.jsonc", "⚠️ missing"]);
    return result;
  }

  const wrangler = fs.readFileSync(wranglerPath, "utf8");
  result.push([
    "production route",
    wrangler.includes(PRODUCTION_HOSTNAME) ? `✅ ${PRODUCTION_HOSTNAME}` : "⚠️ production host missing",
  ]);
  result.push([
    "custom_domain",
    wrangler.includes('"custom_domain": true') ? "✅ true" : "⚠️ not true",
  ]);
  result.push([
    "workers_dev",
    wrangler.includes('"workers_dev": false') ? "✅ false" : "⚠️ not false",
  ]);
  result.push([
    "hyperdrive id",
    /placeholder|replace/i.test(wrangler) ? "⚠️ placeholder present" : "✅ no obvious placeholder",
  ]);
  return result;
}

function buildReport(env = process.env, root = process.cwd()) {
  const rows = [];

  for (const key of PUBLIC_ENV_KEYS) {
    rows.push([key, valueState(env[key])]);
  }
  for (const key of SECRET_ENV_KEYS) {
    const state = key.endsWith("DATABASE_URL") || key === "DATABASE_URL" ? secretUrlState(env[key]) : valueState(env[key], { secret: true });
    rows.push([key, state]);
  }

  const wranglerRows = inspectWrangler(root);

  const readinessChecks = [
    ["Production URL fixed", env.CODIP_BASE_URL === PRODUCTION_URL],
    ["Deploy target is production or staging", ["production", "staging"].includes(env.CODIP_DEPLOY_TARGET ?? "")],
    ["Hyperdrive binding named", Boolean(env.CODIP_HYPERDRIVE_BINDING?.trim()) && !hasPlaceholder(env.CODIP_HYPERDRIVE_BINDING)],
    ["Neon branch named", Boolean(env.CODIP_NEON_BRANCH?.trim()) && !hasPlaceholder(env.CODIP_NEON_BRANCH)],
    ["Runtime DB URL set", Boolean(env.DATABASE_URL?.trim()) && secretUrlState(env.DATABASE_URL).startsWith("✅")],
    [
      "Migration DB URL set",
      Boolean(env.CODIP_MIGRATION_DATABASE_URL?.trim()) && secretUrlState(env.CODIP_MIGRATION_DATABASE_URL).startsWith("✅"),
    ],
  ];

  const ready = readinessChecks.every(([, ok]) => ok);

  const lines = [
    "# Cloudflare / Neon Production Evidence",
    "",
    `- Target URL: \`${PRODUCTION_URL}\``,
    `- Overall: ${ready ? "✅ evidence inputs look ready" : "⚠️ evidence inputs incomplete"}`,
    "",
    "## Environment Evidence",
    "",
    "| Key | State |",
    "| --- | --- |",
    ...rows.map(([key, state]) => `| \`${key}\` | ${state} |`),
    "",
    "## Wrangler Evidence",
    "",
    "| Check | State |",
    "| --- | --- |",
    ...wranglerRows.map(([key, state]) => `| ${key} | ${state} |`),
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
    "| Cloudflare Access | application domain, policy name, allowlist summary |",
    "| Workers logs | error count / request sample / trace query timestamp |",
    "| Hyperdrive | binding name and config id, with connection string omitted |",
    "| Neon | branch name, migration status, PostGIS capability, capacity summary |",
    "| Smoke | `npm run release:smoke -- --read-only --base-url https://civilopendata.mirai-dx-platform.com` result |",
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
