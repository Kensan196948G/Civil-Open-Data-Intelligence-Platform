import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/check-neon-backup-evidence.js");

const freshEvidence = {
  checkedAt: "2026-07-20T07:00:00Z",
  projectId: "falling-dawn-93620497",
  branch: "main",
  endpointHost: "ep-main.example.neon.tech",
  historyWindowHours: 24,
  lastPgDumpAt: "2026-07-20T06:30:00Z",
  lastPgDumpStatus: "success",
  lastPgDumpArtifact: "secure-artifact://codip/neon/20260720T063000Z.dump",
  lastRestoreDrillAt: "2026-07-19T06:30:00Z",
  restoreDrillStatus: "success",
  owner: "release-manager",
};

function runGate(evidence: unknown, extraArgs: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--now",
      "2026-07-20T07:30:00Z",
      "--evidence-json",
      JSON.stringify(evidence),
      ...extraArgs,
    ],
    {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
      },
      encoding: "utf8",
    },
  );
}

describe("check-neon-backup-evidence", () => {
  it("passes when PITR, pg_dump, and restore drill evidence is fresh", () => {
    const result = runGate(freshEvidence);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Overall: ✅ backup evidence fresh");
    expect(result.stdout).toContain("historyWindowHours meets minimum | ✅");
    expect(result.stdout).toContain("lastPgDumpAt is fresh | ✅");
    expect(result.stdout).toContain("lastRestoreDrillAt is fresh | ✅");
  });

  it("fails when the pg_dump evidence is older than the allowed interval", () => {
    const result = runGate({
      ...freshEvidence,
      lastPgDumpAt: "2026-07-19T06:00:00Z",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: ⚠️ backup evidence incomplete or stale");
    expect(result.stdout).toContain("lastPgDumpAt is fresh | ⚠️");
    expect(result.stdout).toContain("25.5h old");
  });

  it("fails when the Neon PITR history window is shorter than required", () => {
    const result = runGate({
      ...freshEvidence,
      historyWindowHours: 12,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historyWindowHours meets minimum | ⚠️");
    expect(result.stdout).toContain("12h (minimum 24h)");
  });

  it("fails when restore drill evidence is stale", () => {
    const result = runGate({
      ...freshEvidence,
      lastRestoreDrillAt: "2026-06-01T00:00:00Z",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("lastRestoreDrillAt is fresh | ⚠️");
  });

  it("redacts secret-looking values from stdout and stderr", () => {
    const result = runGate({
      ...freshEvidence,
      lastPgDumpStatus: "failed password=super-secret",
      lastPgDumpArtifact:
        "postgresql://codip:super-secret-runtime-pass@ep-runtime.aws.neon.tech/codip?sslmode=require",
      owner: "token=super-secret-token",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("super-secret");
    expect(result.stdout).toContain("[REDACTED_POSTGRES_URL]");
    expect(result.stdout).toContain("[REDACTED_SECRET]");
  });
});
