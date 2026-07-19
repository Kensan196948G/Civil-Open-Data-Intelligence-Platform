import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts/tools/validate-env.js");
const productionTargetScriptPath = path.join(
  process.cwd(),
  "scripts/tools/validate-production-target-env.js",
);

function runValidateEnv(mode: "local" | "preview" | "production", env: Record<string, string>) {
  return spawnSync(process.execPath, [scriptPath, "--mode", mode], {
    cwd: os.tmpdir(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ...env,
    },
    encoding: "utf8",
  });
}

function runValidateProductionTargetEnv(env: Record<string, string>) {
  return spawnSync(process.execPath, [productionTargetScriptPath], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ...env,
    },
    encoding: "utf8",
  });
}

describe("validate-env release contract", () => {
  it("rejects SQLite in production", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "file:./dev.db",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Production must not use SQLite");
  });

  it("rejects unsupported database URLs in every release mode", () => {
    const preview = runValidateEnv("preview", {
      DATABASE_URL: "mysql://codip:codip@example.com:3306/codip",
      CODIP_ADMIN_TOKEN: "preview-admin-token-1234567890123",
    });
    const production = runValidateEnv("production", {
      DATABASE_URL: "not-a-url",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
    });

    expect(preview.status).toBe(1);
    expect(preview.stderr).toContain("DATABASE_URL must start with");
    expect(production.status).toBe(1);
    expect(production.stderr).toContain("DATABASE_URL must start with");
  });

  it("requires explicit SQLite acceptance in preview", () => {
    const result = runValidateEnv("preview", {
      DATABASE_URL: "file:./dev.db",
      CODIP_ADMIN_TOKEN: "preview-admin-token-1234567890123",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CODIP_ACCEPT_SQLITE_PREVIEW=true");
  });

  it("accepts SQLite preview only with the preview flag and a strong admin token", () => {
    const result = runValidateEnv("preview", {
      DATABASE_URL: "file:./dev.db",
      CODIP_ACCEPT_SQLITE_PREVIEW: "true",
      CODIP_ADMIN_TOKEN: "preview-admin-token-1234567890123",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[env] OK (preview)");
    expect(result.stderr).toContain("SQLite is accepted for preview only");
  });

  it("rejects weak admin tokens in preview", () => {
    const result = runValidateEnv("preview", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public",
      CODIP_ADMIN_TOKEN: "short",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CODIP_ADMIN_TOKEN must be at least");
  });

  it("rejects run-migrations-on-start in production", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
      CODIP_RUN_MIGRATIONS_ON_START: "true",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CODIP_RUN_MIGRATIONS_ON_START=true");
  });

  it("requires TLS mode for external production PostgreSQL hosts", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sslmode=require or sslmode=verify-full");
  });

  it("allows internal Docker PostgreSQL host in production runner smoke", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@postgres:5432/codip?schema=public",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[env] OK (production)");
  });

  it("accepts proxy authentication guard without an admin token", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_TRUST_PROXY_AUTH: "true",
      CODIP_TRUST_PROXY_SECRET: "proxy-secret-token-123456789012345",
      CODIP_ADMIN_EMAIL_DOMAINS: "example.com",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[env] OK (production)");
  });

  it("requires proxy authentication when token auth is disabled in production", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
      CODIP_DISABLE_TOKEN_AUTH: "true",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CODIP_DISABLE_TOKEN_AUTH=true requires a valid proxy authentication guard");
  });

  it("accepts disabled token auth when a proxy authentication guard is configured", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
      CODIP_DISABLE_TOKEN_AUTH: "true",
      CODIP_TRUST_PROXY_AUTH: "true",
      CODIP_TRUST_PROXY_SECRET: "proxy-secret-token-123456789012345",
      CODIP_ADMIN_EMAIL_DOMAINS: "example.com",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[env] OK (production)");
  });

  it("rejects invalid token auth disable flag values", () => {
    const result = runValidateEnv("production", {
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
      CODIP_DISABLE_TOKEN_AUTH: "yes",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CODIP_DISABLE_TOKEN_AUTH must be true or false");
  });

  it("rejects synthetic production values for real target validation", () => {
    const result = runValidateProductionTargetEnv({
      CODIP_DEPLOY_TARGET: "production",
      DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_MIGRATION_DATABASE_URL: "postgresql://codip:codip@example.com:5432/codip?schema=public&sslmode=require",
      CODIP_BASE_URL: "https://example.com",
      CODIP_HYPERDRIVE_BINDING: "example-hyperdrive",
      CODIP_NEON_BRANCH: "example-branch",
      CODIP_ADMIN_TOKEN: "production-admin-token-1234567890",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL must point to the real external target");
    expect(result.stderr).toContain("CODIP_BASE_URL must not point to example.com");
    expect(result.stderr).toContain("CODIP_ADMIN_TOKEN contains a placeholder value");
  });

  it("accepts a fully specified production target environment shape", () => {
    const result = runValidateProductionTargetEnv({
      CODIP_DEPLOY_TARGET: "staging",
      DATABASE_URL: "postgresql://codip:secret@ep-codip-neon.aws.neon.tech/codip?schema=public&sslmode=require",
      CODIP_MIGRATION_DATABASE_URL:
        "postgresql://codip:secret@ep-codip-neon-direct.aws.neon.tech/codip?schema=public&sslmode=verify-full",
      CODIP_BASE_URL: "https://codip-staging.mirai-dx.jp",
      CODIP_HYPERDRIVE_BINDING: "CODIP_HYPERDRIVE",
      CODIP_NEON_BRANCH: "codip-staging-20260713",
      CODIP_ADMIN_TOKEN: "realistic-random-target-token-123456",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[production-target-env] OK (staging)");
  });
});
