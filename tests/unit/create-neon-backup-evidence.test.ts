import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const createScriptPath = path.join(repoRoot, "scripts/tools/create-neon-backup-evidence.js");
const checkScriptPath = path.join(repoRoot, "scripts/tools/check-neon-backup-evidence.js");

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codip-neon-evidence-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function runCreate(args: string[]) {
  return spawnSync(process.execPath, [createScriptPath, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
    },
    encoding: "utf8",
  });
}

function runGate(evidenceJson: string) {
  return spawnSync(
    process.execPath,
    [
      checkScriptPath,
      "--now",
      "2026-07-20T07:30:00Z",
      "--evidence-json",
      evidenceJson,
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

describe("create-neon-backup-evidence", () => {
  it("creates non-secret evidence from a pg_dump artifact file that passes the freshness gate", () => {
    const dumpPath = path.join(tempDir, "codip.dump");
    fs.writeFileSync(dumpPath, "fake pg_dump artifact metadata only\n");
    fs.utimesSync(dumpPath, new Date("2026-07-20T06:30:00Z"), new Date("2026-07-20T06:30:00Z"));

    const result = runCreate([
      "--project-id",
      "falling-dawn-93620497",
      "--branch",
      "main",
      "--endpoint-host",
      "ep-main.example.neon.tech",
      "--history-window-hours",
      "24",
      "--pg-dump-file",
      dumpPath,
      "--restore-drill-at",
      "2026-07-19T06:30:00Z",
      "--owner",
      "release-manager",
      "--checked-at",
      "2026-07-20T07:00:00Z",
    ]);

    expect(result.status).toBe(0);
    const evidence = JSON.parse(result.stdout);
    expect(evidence).toMatchObject({
      checkedAt: "2026-07-20T07:00:00.000Z",
      projectId: "falling-dawn-93620497",
      branch: "main",
      endpointHost: "ep-main.example.neon.tech",
      historyWindowHours: 24,
      lastPgDumpAt: "2026-07-20T06:30:00.000Z",
      lastPgDumpStatus: "success",
      lastPgDumpArtifact: "file://codip.dump",
      lastRestoreDrillAt: "2026-07-19T06:30:00.000Z",
      restoreDrillStatus: "success",
      owner: "release-manager",
    });
    expect(evidence.pgDumpSizeBytes).toBeGreaterThan(0);

    const gate = runGate(result.stdout);
    expect(gate.status).toBe(0);
    expect(gate.stdout).toContain("Overall: ✅ backup evidence fresh");
  });

  it("creates evidence from an external artifact identifier without reading dump contents", () => {
    const result = runCreate([
      "--project-id",
      "falling-dawn-93620497",
      "--branch",
      "main",
      "--endpoint-host",
      "ep-main.example.neon.tech",
      "--history-window-hours",
      "24",
      "--pg-dump-artifact",
      "secure-artifact://codip/neon/20260720T063000Z.dump",
      "--pg-dump-at",
      "2026-07-20T06:30:00Z",
      "--restore-drill-at",
      "2026-07-19T06:30:00Z",
      "--owner",
      "release-manager",
    ]);

    expect(result.status).toBe(0);
    const evidence = JSON.parse(result.stdout);
    expect(evidence.lastPgDumpArtifact).toBe("secure-artifact://codip/neon/20260720T063000Z.dump");
    expect(evidence).not.toHaveProperty("pgDumpSizeBytes");
  });

  it("rejects secret-looking artifact identifiers without printing the secret", () => {
    const result = runCreate([
      "--project-id",
      "falling-dawn-93620497",
      "--branch",
      "main",
      "--endpoint-host",
      "ep-main.example.neon.tech",
      "--history-window-hours",
      "24",
      "--pg-dump-artifact",
      "postgresql://codip:super-secret@ep-neon.aws.neon.tech/codip",
      "--pg-dump-at",
      "2026-07-20T06:30:00Z",
      "--restore-drill-at",
      "2026-07-19T06:30:00Z",
      "--owner",
      "release-manager",
    ]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("super-secret");
    expect(result.stderr).toContain("pgDumpArtifact must not contain a secret-looking value");
  });
});
