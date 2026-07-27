#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PLACEHOLDER_PATTERNS = [
  /example/i,
  /change[-_]?this/i,
  /placeholder/i,
  /dummy/i,
  /ci[-_]/i,
  /production-admin-token/i,
  /preview-admin-token/i,
];
const PRODUCTION_BASE_HOSTNAME = "odip.mirai-dx-platform.com";

function fail(errors, message) {
  errors.push(message);
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isPostgresUrl(value) {
  return value.startsWith("postgresql://") || value.startsWith("postgres://");
}

function hasRequiredSslMode(url) {
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  return sslMode === "require" || sslMode === "verify-full";
}

function hasPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function validateExternalPostgres(errors, envName, value) {
  if (!value) {
    fail(errors, `${envName} is required for production target validation`);
    return;
  }
  if (!isPostgresUrl(value)) {
    fail(errors, `${envName} must be a PostgreSQL URL`);
    return;
  }

  const parsed = parseUrl(value);
  if (!parsed) {
    fail(errors, `${envName} is not a valid URL`);
    return;
  }

  if (["localhost", "127.0.0.1", "::1", "postgres", "example.com"].includes(parsed.hostname)) {
    fail(errors, `${envName} must point to the real external target, not ${parsed.hostname}`);
  }
  if (hasPlaceholder(value)) {
    fail(errors, `${envName} contains a placeholder value`);
  }
  if (!hasRequiredSslMode(parsed)) {
    fail(errors, `${envName} must include sslmode=require or sslmode=verify-full`);
  }
}

function main() {
  const root = process.cwd();
  const env = process.env;
  const errors = [];

  const baseValidation = spawnSync(process.execPath, [path.join(root, "scripts/tools/validate-env.js"), "--mode", "production"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  process.stdout.write(baseValidation.stdout ?? "");
  process.stderr.write(baseValidation.stderr ?? "");
  if (baseValidation.status !== 0) {
    process.exit(baseValidation.status ?? 1);
  }

  const deployTarget = env.CODIP_DEPLOY_TARGET?.trim() ?? "";
  if (!["staging", "production"].includes(deployTarget)) {
    fail(errors, "CODIP_DEPLOY_TARGET must be staging or production for real target validation");
  }

  validateExternalPostgres(errors, "DATABASE_URL", env.DATABASE_URL?.trim() ?? "");
  validateExternalPostgres(errors, "CODIP_MIGRATION_DATABASE_URL", env.CODIP_MIGRATION_DATABASE_URL?.trim() ?? "");

  const baseUrl = env.CODIP_BASE_URL?.trim() ?? "";
  const parsedBaseUrl = parseUrl(baseUrl);
  if (!parsedBaseUrl || parsedBaseUrl.protocol !== "https:") {
    fail(errors, "CODIP_BASE_URL must be the real https:// target URL");
  } else if (["localhost", "127.0.0.1", "::1", "example.com"].includes(parsedBaseUrl.hostname)) {
    fail(errors, `CODIP_BASE_URL must not point to ${parsedBaseUrl.hostname}`);
  } else if (deployTarget === "production" && parsedBaseUrl.hostname !== PRODUCTION_BASE_HOSTNAME) {
    fail(errors, `Production CODIP_BASE_URL must be https://${PRODUCTION_BASE_HOSTNAME}`);
  }
  if (baseUrl && hasPlaceholder(baseUrl)) {
    fail(errors, "CODIP_BASE_URL contains a placeholder value");
  }

  for (const key of ["CODIP_HYPERDRIVE_BINDING", "CODIP_NEON_BRANCH"]) {
    const value = env[key]?.trim() ?? "";
    if (!value) fail(errors, `${key} is required for Cloudflare/Neon target evidence`);
    if (value && hasPlaceholder(value)) fail(errors, `${key} contains a placeholder value`);
  }

  const adminToken = env.CODIP_ADMIN_TOKEN?.trim() ?? "";
  const proxySecret = env.CODIP_TRUST_PROXY_SECRET?.trim() ?? "";
  const disableTokenAuth = env.CODIP_DISABLE_TOKEN_AUTH?.trim().toLowerCase() ?? "";
  const trustProxyAuth = env.CODIP_TRUST_PROXY_AUTH?.trim().toLowerCase() ?? "";
  const adminEmails = env.CODIP_ADMIN_EMAILS?.trim() ?? "";
  const adminDomains = env.CODIP_ADMIN_EMAIL_DOMAINS?.trim() ?? "";
  if (adminToken && hasPlaceholder(adminToken)) fail(errors, "CODIP_ADMIN_TOKEN contains a placeholder value");
  if (proxySecret && hasPlaceholder(proxySecret)) fail(errors, "CODIP_TRUST_PROXY_SECRET contains a placeholder value");

  if (deployTarget === "production") {
    if (disableTokenAuth !== "true") {
      fail(errors, "Production target requires CODIP_DISABLE_TOKEN_AUTH=true");
    }
    if (trustProxyAuth !== "true") {
      fail(errors, "Production target requires CODIP_TRUST_PROXY_AUTH=true");
    }
    if (!proxySecret) {
      fail(errors, "Production target requires CODIP_TRUST_PROXY_SECRET");
    }
    if (!adminEmails && !adminDomains) {
      fail(errors, "Production target requires CODIP_ADMIN_EMAILS or CODIP_ADMIN_EMAIL_DOMAINS");
    }
  }

  for (const key of [
    "CODIP_ALLOW_INSECURE_ADMIN",
    "CODIP_ALLOW_INSECURE_LOCAL_COOKIES",
    "CODIP_ACCEPT_SQLITE_PREVIEW",
    "CODIP_RUN_MIGRATIONS_ON_START",
  ]) {
    if (env[key] === "true") fail(errors, `${key}=true is not allowed for production target validation`);
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`[production-target-env][error] ${error}`);
    process.exit(1);
  }

  console.log(`[production-target-env] OK (${deployTarget})`);
}

main();
