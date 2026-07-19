import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/production-evidence-report.js");

const completeEvidenceEnv = {
  CODIP_DEPLOY_TARGET: "production",
  CODIP_BASE_URL: "https://civilopendata.mirai-dx-platform.com",
  CODIP_HYPERDRIVE_BINDING: "CODIP_HYPERDRIVE",
  CODIP_NEON_BRANCH: "codip-production-20260719",
  DATABASE_URL:
    "postgresql://codip:super-secret-runtime-pass@ep-runtime.aws.neon.tech/codip?sslmode=require",
  CODIP_MIGRATION_DATABASE_URL:
    "postgresql://codip:super-secret-migration-pass@ep-direct.aws.neon.tech/codip?sslmode=verify-full",
  CODIP_ADMIN_TOKEN: "real-admin-token-that-must-not-print-123456",
  CODIP_TRUST_PROXY_SECRET: "real-proxy-secret-that-must-not-print-123456",
  CODIP_DISABLE_TOKEN_AUTH: "true",
  CODIP_TRUST_PROXY_AUTH: "true",
  CODIP_ADMIN_EMAIL_DOMAINS: "mirai-dx-platform.com",
  CODIP_CLOUDFLARE_ACCESS_EVIDENCE: "Access app civilopendata policy allowlist recorded",
  CODIP_MONITORING_CONTACTS: "release-oncall",
  CODIP_CLOUDFLARE_ALERT_POLICY: "codip-production-p1",
  CODIP_CLOUDFLARE_LOGS_EVIDENCE: "workers logs query recorded",
  CODIP_NEON_MONITORING_EVIDENCE: "neon branch metrics recorded",
  CODIP_SMOKE_MONITORING_SCHEDULE: "*/5 read-only smoke",
  CODIP_ROLLBACK_OWNER: "release-manager",
  CODIP_BACKUP_RESTORE_EVIDENCE: "neon pitr restore rehearsal recorded",
};

function writeWrangler(root: string, hyperdriveId: string) {
  fs.writeFileSync(
    path.join(root, "wrangler.jsonc"),
    `{
      "observability": { "enabled": true },
      "hyperdrive": [
        { "binding": "HYPERDRIVE", "id": "REPLACE_WITH_WRANGLER_HYPERDRIVE_CREATE_OUTPUT" }
      ],
      "env": {
        "preview": {
          "hyperdrive": [
            { "binding": "HYPERDRIVE", "id": "REPLACE_WITH_STAGING_HYPERDRIVE_ID" }
          ]
        },
        "production": {
          "workers_dev": false,
          "routes": [
            { "pattern": "civilopendata.mirai-dx-platform.com", "custom_domain": true }
          ],
          "hyperdrive": [
            { "binding": "HYPERDRIVE", "id": "${hyperdriveId}" }
          ]
        }
      }
    }`,
  );
}

function withWrangler(hyperdriveId: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codip-production-evidence-"));
  writeWrangler(root, hyperdriveId);
  return root;
}

function runProductionEvidence(env: Record<string, string>, args: string[] = [], cwd = repoRoot) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ...env,
    },
    encoding: "utf8",
  });
}

describe("production-evidence-report", () => {
  it("redacts secrets while reporting production evidence readiness", () => {
    const result = runProductionEvidence(completeEvidenceEnv, ["--strict"], withWrangler("hdg_prod_1234567890abcdef"));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Overall: ✅ evidence inputs look ready");
    expect(result.stdout).toContain("DATABASE_URL");
    expect(result.stdout).toContain("set (redacted");
    expect(result.stdout).toContain("Monitoring Evidence");
    expect(result.stdout).toContain("CODIP_CLOUDFLARE_ACCESS_EVIDENCE");
    expect(result.stdout).toContain("CODIP_CLOUDFLARE_ALERT_POLICY");
    expect(result.stdout).toContain("Backup / Restore Evidence");
    expect(result.stdout).toContain("CODIP_BACKUP_RESTORE_EVIDENCE");
    expect(result.stdout).toContain("set (recorded)");
    expect(result.stdout).toContain("Wrangler production Hyperdrive id resolved | ✅");
    expect(result.stdout).not.toContain("super-secret-runtime-pass");
    expect(result.stdout).not.toContain("super-secret-migration-pass");
    expect(result.stdout).not.toContain("real-admin-token-that-must-not-print");
    expect(result.stdout).not.toContain("real-proxy-secret-that-must-not-print");
    expect(result.stdout).not.toContain("workers logs query recorded");
    expect(result.stdout).not.toContain("Access app civilopendata policy allowlist recorded");
    expect(result.stdout).not.toContain("neon pitr restore rehearsal recorded");
  });

  it("fails strict mode when required Cloudflare or Neon evidence is missing", () => {
    const result = runProductionEvidence(
      {
        CODIP_DEPLOY_TARGET: "production",
        CODIP_BASE_URL: "https://civilopendata.mirai-dx-platform.com",
      },
      ["--strict"],
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: ⚠️ evidence inputs incomplete");
    expect(result.stdout).toContain("Hyperdrive binding named | ⚠️");
    expect(result.stdout).toContain("Runtime DB URL set | ⚠️");
    expect(result.stdout).toContain("Cloudflare alert policy recorded | ⚠️");
    expect(result.stdout).toContain("Cloudflare Access evidence recorded | ⚠️");
    expect(result.stdout).toContain("Neon monitoring evidence recorded | ⚠️");
    expect(result.stdout).toContain("Backup/restore evidence recorded | ⚠️");
  });

  it("fails strict mode when wrangler production placeholders remain", () => {
    const result = runProductionEvidence(
      completeEvidenceEnv,
      ["--strict"],
      withWrangler("REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: ⚠️ evidence inputs incomplete");
    expect(result.stdout).toContain("hyperdrive id | ⚠️ missing or placeholder present");
    expect(result.stdout).toContain("Wrangler production Hyperdrive id resolved | ⚠️");
  });
});
