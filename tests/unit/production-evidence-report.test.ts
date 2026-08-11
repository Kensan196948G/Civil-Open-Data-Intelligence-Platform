import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/production-evidence-report.js");

const completeEvidenceEnv = {
  CODIP_DEPLOY_TARGET: "production",
  CODIP_BASE_URL: "https://odip.mirai-dx-platform.com",
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
  // Issue #128: these now have to satisfy the format requirements pinned in
  // production-evidence-report.js. The previous fixture values ("release-oncall",
  // "*/5 read-only smoke", ...) were exactly the shapes the gate used to accept
  // without meaning anything, so they are reused below as negative cases.
  CODIP_CLOUDFLARE_ACCESS_EVIDENCE:
    "odip.mirai-dx-platform.com policy=codip-release-admins verified=2026-07-19",
  CODIP_MONITORING_CONTACTS: "release-oncall@mirai-dx-platform.com, #codip-alerts",
  CODIP_CLOUDFLARE_ALERT_POLICY: "codip-production-p1 notification-test=2026-07-19",
  CODIP_CLOUDFLARE_LOGS_EVIDENCE: "workers logs queried 2026-07-19T06:30:00Z errors=0",
  CODIP_NEON_MONITORING_EVIDENCE: "branch codip-production checked 2026-07-19 slow-queries=0",
  CODIP_SMOKE_MONITORING_SCHEDULE: "*/15 * * * *",
  CODIP_ROLLBACK_OWNER: "release-manager",
  CODIP_BACKUP_RESTORE_EVIDENCE: "neon pitr 24h drill 2026-07-19 outcome=success",
};

function writeWrangler(root: string, hyperdriveId: string, previewHyperdriveId = "REPLACE_WITH_STAGING_HYPERDRIVE_ID") {
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
            { "binding": "HYPERDRIVE", "id": "${previewHyperdriveId}" }
          ]
        },
        "production": {
          "workers_dev": false,
          "routes": [
            { "pattern": "odip.mirai-dx-platform.com/*", "zone_name": "mirai-dx-platform.com" }
          ],
          "hyperdrive": [
            { "binding": "HYPERDRIVE", "id": "${hyperdriveId}" }
          ]
        }
      }
    }`,
  );
}

function withWrangler(hyperdriveId: string, previewHyperdriveId?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codip-production-evidence-"));
  writeWrangler(root, hyperdriveId, previewHyperdriveId);
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
    expect(result.stdout).toContain("Deploy target: `production`");
    expect(result.stdout).toContain("Target URL: `https://odip.mirai-dx-platform.com`");
    expect(result.stdout).toContain("DATABASE_URL");
    expect(result.stdout).toContain("set (redacted");
    expect(result.stdout).toContain("Monitoring Evidence");
    expect(result.stdout).toContain("CODIP_CLOUDFLARE_ACCESS_EVIDENCE");
    expect(result.stdout).toContain("CODIP_CLOUDFLARE_ALERT_POLICY");
    expect(result.stdout).toContain("Backup / Restore Evidence");
    expect(result.stdout).toContain("CODIP_BACKUP_RESTORE_EVIDENCE");
    expect(result.stdout).toContain("set (recorded, format checked)");
    expect(result.stdout).toContain("Wrangler production Hyperdrive id resolved | ✅");
    expect(result.stdout).not.toContain("super-secret-runtime-pass");
    expect(result.stdout).not.toContain("super-secret-migration-pass");
    expect(result.stdout).not.toContain("real-admin-token-that-must-not-print");
    expect(result.stdout).not.toContain("real-proxy-secret-that-must-not-print");
    // Evidence values stay out of the report: they carry contact details and
    // operational notes, and a failing format check must not print them either.
    expect(result.stdout).not.toContain(completeEvidenceEnv.CODIP_CLOUDFLARE_LOGS_EVIDENCE);
    expect(result.stdout).not.toContain(completeEvidenceEnv.CODIP_CLOUDFLARE_ACCESS_EVIDENCE);
    expect(result.stdout).not.toContain(completeEvidenceEnv.CODIP_BACKUP_RESTORE_EVIDENCE);
    expect(result.stdout).not.toContain(completeEvidenceEnv.CODIP_MONITORING_CONTACTS);
  });

  it("fails strict mode when required Cloudflare or Neon evidence is missing", () => {
    const result = runProductionEvidence(
      {
        CODIP_DEPLOY_TARGET: "production",
        CODIP_BASE_URL: "https://odip.mirai-dx-platform.com",
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

  it("accepts staging target evidence without requiring the production custom domain", () => {
    const result = runProductionEvidence(
      {
        ...completeEvidenceEnv,
        CODIP_DEPLOY_TARGET: "staging",
        CODIP_BASE_URL: "https://codip-staging.mirai-dx-platform.com",
        CODIP_NEON_BRANCH: "codip-staging-20260719",
      },
      ["--strict"],
      withWrangler("REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID", "hdg_staging_1234567890abcdef"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Deploy target: `staging`");
    expect(result.stdout).toContain("Target URL: `https://codip-staging.mirai-dx-platform.com`");
    expect(result.stdout).toContain("Target URL is a real HTTPS URL | ✅");
    expect(result.stdout).toContain("Wrangler preview Hyperdrive id resolved | ✅");
    expect(result.stdout).not.toContain("Wrangler production route configured");
    expect(result.stdout).not.toContain("Wrangler production Hyperdrive id resolved");
  });

  it("fails production strict mode when proxy-only admin hardening is incomplete", () => {
    const result = runProductionEvidence(
      {
        ...completeEvidenceEnv,
        CODIP_DISABLE_TOKEN_AUTH: "false",
        CODIP_TRUST_PROXY_AUTH: "false",
        CODIP_TRUST_PROXY_SECRET: "",
        CODIP_ADMIN_EMAIL_DOMAINS: "",
      },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: ⚠️ evidence inputs incomplete");
    expect(result.stdout).toContain("Production direct token auth disabled | ⚠️");
    expect(result.stdout).toContain("Production proxy auth enabled | ⚠️");
    expect(result.stdout).toContain("Production proxy secret set | ⚠️");
    expect(result.stdout).toContain("Production admin allowlist recorded | ⚠️");
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

// --- Issue #128 ------------------------------------------------------------

const EVIDENCE_READINESS_LABELS = [
  "Cloudflare Access evidence recorded",
  "Monitoring contacts recorded",
  "Cloudflare alert policy recorded",
  "Cloudflare logs evidence recorded",
  "Neon monitoring evidence recorded",
  "Smoke monitoring schedule recorded",
  "Rollback owner recorded",
  "Backup/restore evidence recorded",
];

const EVIDENCE_KEYS = [
  "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
  "CODIP_MONITORING_CONTACTS",
  "CODIP_CLOUDFLARE_ALERT_POLICY",
  "CODIP_CLOUDFLARE_LOGS_EVIDENCE",
  "CODIP_NEON_MONITORING_EVIDENCE",
  "CODIP_SMOKE_MONITORING_SCHEDULE",
  "CODIP_ROLLBACK_OWNER",
  "CODIP_BACKUP_RESTORE_EVIDENCE",
] as const;

describe("production evidence format requirements (Issue #128)", () => {
  it("rejects the two characters that used to satisfy all eight checks", () => {
    // This is the defect verbatim from Issue #128: `ok` is non-empty and matches
    // no placeholder pattern, so before this change every evidence readiness
    // check reported ✅ and the release recorded a monitoring posture nobody had.
    const okEverywhere = Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, "ok"]));
    const result = runProductionEvidence(
      { ...completeEvidenceEnv, ...okEverywhere },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: ⚠️ evidence inputs incomplete");
    for (const label of EVIDENCE_READINESS_LABELS) {
      expect(result.stdout).toContain(`${label} | ⚠️`);
    }
  });

  it.each([
    [
      "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
      "Access policy configured and reviewed by the team",
      "Cloudflare Access evidence recorded",
    ],
    ["CODIP_MONITORING_CONTACTS", "release-oncall", "Monitoring contacts recorded"],
    [
      "CODIP_CLOUDFLARE_ALERT_POLICY",
      "alert policy is in place and tested",
      "Cloudflare alert policy recorded",
    ],
    [
      "CODIP_CLOUDFLARE_LOGS_EVIDENCE",
      "workers logs query recorded",
      "Cloudflare logs evidence recorded",
    ],
    [
      "CODIP_NEON_MONITORING_EVIDENCE",
      "neon branch metrics recorded",
      "Neon monitoring evidence recorded",
    ],
    [
      "CODIP_SMOKE_MONITORING_SCHEDULE",
      "*/5 read-only smoke",
      "Smoke monitoring schedule recorded",
    ],
    ["CODIP_ROLLBACK_OWNER", "human: kensan (manual rollback only)", "Rollback owner recorded"],
    [
      "CODIP_BACKUP_RESTORE_EVIDENCE",
      "neon pitr restore rehearsal recorded",
      "Backup/restore evidence recorded",
    ],
  ])("fails strict mode when %s has no verifiable shape", (key, value, readinessLabel) => {
    const result = runProductionEvidence(
      { ...completeEvidenceEnv, [key]: value },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: ⚠️ evidence inputs incomplete");
    // Assert on the specific row: a non-zero exit alone would also be produced
    // by any unrelated readiness check, which would make this test pass for the
    // wrong reason.
    expect(result.stdout).toContain(`${readinessLabel} | ⚠️`);
    for (const other of EVIDENCE_READINESS_LABELS.filter((label) => label !== readinessLabel)) {
      expect(result.stdout).toContain(`${other} | ✅`);
    }
  });

  it("does not read 'unsuccessful' as the drill outcome 'success'", () => {
    // A substring test would accept this and turn a failed drill into a passed
    // one. The vocabulary match is anchored on word boundaries for that reason.
    const result = runProductionEvidence(
      {
        ...completeEvidenceEnv,
        CODIP_BACKUP_RESTORE_EVIDENCE: "neon pitr 24h drill 2026-07-19 was unsuccessful",
      },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Backup/restore evidence recorded | ⚠️");
  });

  it("rejects a recorded non-passing drill outcome in strict mode", () => {
    // `not-run` / `failed` / `partial` / `blocked` are recordable vocabulary,
    // but only `success` satisfies the deploy evidence gate
    // (docs/runbooks/restore-drill-record.md §1.2).
    const result = runProductionEvidence(
      {
        ...completeEvidenceEnv,
        CODIP_BACKUP_RESTORE_EVIDENCE: "neon pitr 24h drill 2026-07-19 outcome=not-run",
      },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Backup/restore evidence recorded | ⚠️");
    expect(result.stdout).toContain("drill outcome is not passing");
  });

  it.each([
    ["a date before the project existed", "2019-03-04"],
    ["a date far in the future", "2999-01-01"],
  ])("rejects %s", (_label, date) => {
    const result = runProductionEvidence(
      {
        ...completeEvidenceEnv,
        CODIP_CLOUDFLARE_LOGS_EVIDENCE: `workers logs queried ${date} errors=0`,
      },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Cloudflare logs evidence recorded | ⚠️");
  });

  it("accepts a defined schedule keyword as well as a cron expression", () => {
    const result = runProductionEvidence(
      { ...completeEvidenceEnv, CODIP_SMOKE_MONITORING_SCHEDULE: "per-release" },
      ["--strict"],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Smoke monitoring schedule recorded | ✅");
  });

  it("publishes the expected shape so an operator can act on a ⚠️", () => {
    const result = runProductionEvidence(
      { ...completeEvidenceEnv, CODIP_ROLLBACK_OWNER: "ok" },
      [],
      withWrangler("hdg_prod_1234567890abcdef"),
    );

    expect(result.stdout).toContain("## Evidence Format Requirements");
    expect(result.stdout).toContain("whitespace-free identifier");
    // The report has to name the failing requirement, not just refuse.
    expect(result.stdout).toContain("not a sentence");
  });
});
