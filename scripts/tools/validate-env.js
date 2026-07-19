#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const MODES = new Set(["local", "preview", "production"]);
const MIN_SECRET_LENGTH = 32;

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function csv(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fail(errors, message) {
  errors.push(message);
}

function warn(warnings, message) {
  warnings.push(message);
}

function isStrongSecret(value) {
  return typeof value === "string" && value.trim().length >= MIN_SECRET_LENGTH;
}

function normalizedBoolean(value) {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return null;
}

function isSqliteUrl(databaseUrl) {
  return databaseUrl.startsWith("file:");
}

function isPostgreSqlUrl(databaseUrl) {
  return databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://");
}

function parseDatabaseUrl(databaseUrl) {
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
}

function isLocalPostgresHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "postgres"].includes(hostname);
}

function hasRequiredPostgresSsl(databaseUrl) {
  const url = parseDatabaseUrl(databaseUrl);
  if (!url) return false;
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  return sslMode === "require" || sslMode === "verify-full";
}

function main() {
  loadDotenv(path.join(process.cwd(), ".env"));

  const mode = argValue("--mode", process.env.NODE_ENV === "production" ? "production" : "local");
  if (!MODES.has(mode)) {
    console.error(`Unknown mode: ${mode}. Expected one of: ${[...MODES].join(", ")}`);
    process.exit(2);
  }

  const errors = [];
  const warnings = [];
  const env = process.env;
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const adminToken = env.CODIP_ADMIN_TOKEN?.trim() ?? "";
  const allowInsecureAdmin = env.CODIP_ALLOW_INSECURE_ADMIN === "true";
  const allowInsecureLocalCookies = env.CODIP_ALLOW_INSECURE_LOCAL_COOKIES === "true";
  const runMigrationsOnStart = env.CODIP_RUN_MIGRATIONS_ON_START === "true";
  const trustProxy = env.CODIP_TRUST_PROXY_AUTH === "true";
  const proxySecret = env.CODIP_TRUST_PROXY_SECRET?.trim() ?? "";
  const adminEmails = csv(env.CODIP_ADMIN_EMAILS);
  const adminDomains = csv(env.CODIP_ADMIN_EMAIL_DOMAINS);
  const sqlitePreviewAccepted = env.CODIP_ACCEPT_SQLITE_PREVIEW === "true";
  const disableTokenAuth = normalizedBoolean(env.CODIP_DISABLE_TOKEN_AUTH);

  if (!databaseUrl) {
    fail(errors, "DATABASE_URL is required");
  } else if (!isSqliteUrl(databaseUrl) && !isPostgreSqlUrl(databaseUrl)) {
    fail(errors, "DATABASE_URL must start with file:, postgresql://, or postgres://");
  }

  if (mode !== "local" && allowInsecureAdmin) {
    fail(errors, "CODIP_ALLOW_INSECURE_ADMIN=true is allowed only for local development");
  }

  if (mode !== "local" && allowInsecureLocalCookies) {
    fail(
      errors,
      "CODIP_ALLOW_INSECURE_LOCAL_COOKIES=true is allowed only for local HTTP verification",
    );
  }

  if (disableTokenAuth === null) {
    fail(errors, "CODIP_DISABLE_TOKEN_AUTH must be true or false when set");
  }

  if (mode === "production" && runMigrationsOnStart) {
    fail(errors, "CODIP_RUN_MIGRATIONS_ON_START=true is allowed only for local/preview one-off validation");
  }

  if (mode === "local") {
    if (!adminToken && !trustProxy && !allowInsecureAdmin) {
      warn(
        warnings,
        "No admin guard is configured. Management APIs will fail closed unless CODIP_ALLOW_INSECURE_ADMIN=true is set for local development.",
      );
    }
  } else {
    const tokenGuard = disableTokenAuth !== true && isStrongSecret(adminToken);
    const proxyGuard =
      trustProxy &&
      isStrongSecret(proxySecret) &&
      (adminEmails.length > 0 || adminDomains.length > 0);

    if (!tokenGuard && !proxyGuard) {
      fail(
        errors,
        `Preview/production requires CODIP_ADMIN_TOKEN length >= ${MIN_SECRET_LENGTH}, or CODIP_TRUST_PROXY_AUTH=true with CODIP_TRUST_PROXY_SECRET length >= ${MIN_SECRET_LENGTH} and CODIP_ADMIN_EMAILS/CODIP_ADMIN_EMAIL_DOMAINS.`,
      );
    }

    if (adminToken && !isStrongSecret(adminToken)) {
      fail(
        errors,
        `CODIP_ADMIN_TOKEN must be at least ${MIN_SECRET_LENGTH} characters in preview/production`,
      );
    }

    if (disableTokenAuth === true && !proxyGuard) {
      fail(
        errors,
        "CODIP_DISABLE_TOKEN_AUTH=true requires a valid proxy authentication guard in preview/production",
      );
    }
  }

  if (mode === "production" && databaseUrl && !isPostgreSqlUrl(databaseUrl)) {
    fail(errors, "Production DATABASE_URL must use PostgreSQL/PostGIS with postgresql:// or postgres://");
  }

  if (mode === "production" && databaseUrl && isPostgreSqlUrl(databaseUrl)) {
    const parsedDatabaseUrl = parseDatabaseUrl(databaseUrl);
    if (
      parsedDatabaseUrl &&
      !isLocalPostgresHost(parsedDatabaseUrl.hostname) &&
      !hasRequiredPostgresSsl(databaseUrl)
    ) {
      fail(
        errors,
        "Production PostgreSQL DATABASE_URL for external hosts must include sslmode=require or sslmode=verify-full",
      );
    }
  }

  if (databaseUrl && isSqliteUrl(databaseUrl)) {
    if (mode === "production") {
      fail(errors, "Production must not use SQLite DATABASE_URL=file:. Use PostgreSQL/PostGIS for production.");
    } else if (mode === "preview" && !sqlitePreviewAccepted) {
      fail(
        errors,
        "SQLite preview requires CODIP_ACCEPT_SQLITE_PREVIEW=true to make the limited persistence model explicit.",
      );
    } else if (mode === "preview") {
      warn(warnings, "SQLite is accepted for preview only. Do not use this configuration for production.");
    }
  }

  if (trustProxy && !isStrongSecret(proxySecret)) {
    fail(
      errors,
      `CODIP_TRUST_PROXY_AUTH=true requires CODIP_TRUST_PROXY_SECRET length >= ${MIN_SECRET_LENGTH}`,
    );
  }

  if (trustProxy && adminEmails.length === 0 && adminDomains.length === 0) {
    fail(errors, "CODIP_TRUST_PROXY_AUTH=true requires CODIP_ADMIN_EMAILS or CODIP_ADMIN_EMAIL_DOMAINS");
  }

  for (const message of warnings) {
    console.warn(`[env][warn] ${message}`);
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`[env][error] ${message}`);
    }
    process.exit(1);
  }

  console.log(`[env] OK (${mode})`);
}

if (require.main === module) main();
