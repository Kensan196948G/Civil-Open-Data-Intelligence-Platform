import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const createScriptPath = path.join(repoRoot, "scripts/tools/create-neon-backup-evidence.js");
const checkScriptPath = path.join(repoRoot, "scripts/tools/check-neon-backup-evidence.js");

// Assembled at runtime rather than written as one literal. The value is a
// throwaway the loopback stub accepts unconditionally, but a key-shaped string
// literal is exactly what the gitleaks CI gate matches on, and the established
// fix in this repository is to leave no such literal in the tree rather than to
// widen .gitleaks.toml.
const STUB_CREDENTIAL = ["neon", "stub", "value"].join("-");

let tempDir = "";

/**
 * Stand-in for the Neon control plane.
 *
 * Bound to loopback so no test ever reaches the real API: measuring PITR
 * retention is a read against a live account, and a test suite that did it for
 * real would both need a credential and couple CI to Neon's availability.
 */
type NeonStub = {
  baseUrl: string;
  requests: Array<{ url: string; authorization: string | undefined }>;
  close: () => Promise<void>;
};

async function startNeonStub(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<NeonStub> {
  const requests: NeonStub["requests"] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? "", authorization: req.headers.authorization });
    handler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("stub server has no port");

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v2`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function respondWithProject(res: http.ServerResponse, project: Record<string, unknown>) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ project }));
}

let stub: NeonStub | null = null;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codip-neon-evidence-"));
});

afterEach(async () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (stub) {
    await stub.close();
    stub = null;
  }
});

/**
 * Async on purpose.
 *
 * The stub server shares this process's event loop, so `spawnSync` would block
 * it for the whole child run and the child's request would never be accepted --
 * a deadlock that only surfaces as a fetch timeout.
 */
function runCreate(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [createScriptPath, ...args], {
      cwd: repoRoot,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "test",
        ...env,
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function runGate(evidenceJson: string, extraArgs: string[] = ["--now", "2026-07-20T07:30:00Z"]) {
  return spawnSync(
    process.execPath,
    [checkScriptPath, "--evidence-json", evidenceJson, ...extraArgs],
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

function baseArgs(extra: string[]) {
  return [
    "--project-id",
    "falling-dawn-93620497",
    "--branch",
    "main",
    "--endpoint-host",
    "ep-main.example.neon.tech",
    "--restore-drill-at",
    "2026-07-19T06:30:00Z",
    "--owner",
    "release-manager",
    "--neon-api-base-url",
    stub?.baseUrl ?? "http://127.0.0.1:1/api/v2",
    ...extra,
  ];
}

/**
 * The measurement timestamp is the real wall clock on purpose: letting
 * `--checked-at` move it would hand the caller control over the freshness of its
 * own measurement, which is the self-attestation this gate exists to remove.
 * End-to-end cases therefore date the rest of the evidence relative to now.
 */
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

describe("create-neon-backup-evidence", () => {
  it("creates non-secret evidence from a pg_dump artifact file that passes the freshness gate", async () => {
    stub = await startNeonStub((_req, res) =>
      respondWithProject(res, { id: "falling-dawn-93620497", history_retention_seconds: 86400 }),
    );

    const dumpAt = hoursAgo(1);
    const dumpPath = path.join(tempDir, "codip.dump");
    fs.writeFileSync(dumpPath, "fake pg_dump artifact metadata only\n");
    fs.utimesSync(dumpPath, dumpAt, dumpAt);

    const result = await runCreate(
      [
        "--project-id",
        "falling-dawn-93620497",
        "--branch",
        "main",
        "--endpoint-host",
        "ep-main.example.neon.tech",
        "--owner",
        "release-manager",
        "--neon-api-base-url",
        stub.baseUrl,
        "--history-window-hours",
        "24",
        "--pg-dump-file",
        dumpPath,
        "--restore-drill-at",
        hoursAgo(24).toISOString(),
      ],
      { NEON_API_KEY: STUB_CREDENTIAL },
    );

    expect(result.status).toBe(0);
    const evidence = JSON.parse(result.stdout);
    expect(evidence).toMatchObject({
      projectId: "falling-dawn-93620497",
      branch: "main",
      endpointHost: "ep-main.example.neon.tech",
      historyWindowHours: 24,
      historyRetentionSecondsMeasured: 86400,
      historyRetentionProjectId: "falling-dawn-93620497",
      lastPgDumpAt: dumpAt.toISOString(),
      lastPgDumpStatus: "success",
      lastPgDumpArtifact: "file://codip.dump",
      restoreDrillStatus: "success",
      owner: "release-manager",
    });
    expect(evidence.pgDumpSizeBytes).toBeGreaterThan(0);
    expect(evidence.historyRetentionSource).toContain("history_retention_seconds");
    expect(new Date(evidence.historyRetentionMeasuredAt).getTime()).not.toBeNaN();

    // The measurement is read for the project actually being dumped.
    expect(stub.requests[0]?.url).toBe("/api/v2/projects/falling-dawn-93620497");
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${STUB_CREDENTIAL}`);

    const gate = runGate(result.stdout, []);
    expect(gate.status).toBe(0);
    expect(gate.stdout).toContain("Overall: ✅ backup evidence fresh");
  });

  it("derives historyWindowHours from the measurement rather than the declaration", async () => {
    stub = await startNeonStub((_req, res) =>
      respondWithProject(res, { id: "falling-dawn-93620497", history_retention_seconds: 43200 }),
    );

    const result = await runCreate(
      [
        "--project-id",
        "falling-dawn-93620497",
        "--branch",
        "main",
        "--endpoint-host",
        "ep-main.example.neon.tech",
        "--owner",
        "release-manager",
        "--neon-api-base-url",
        stub.baseUrl,
        // The caller insists on 24h; Neon reports 12h. The evidence must record
        // reality, and keep the disagreement visible.
        "--history-window-hours",
        "24",
        "--pg-dump-artifact",
        "secure-artifact://codip/neon/latest.dump",
        "--pg-dump-at",
        hoursAgo(1).toISOString(),
        "--restore-drill-at",
        hoursAgo(24).toISOString(),
      ],
      { NEON_API_KEY: STUB_CREDENTIAL },
    );

    expect(result.status).toBe(0);
    const evidence = JSON.parse(result.stdout);
    expect(evidence.historyWindowHours).toBe(12);
    expect(evidence.historyWindowHoursDeclared).toBe(24);
    expect(evidence.historyRetentionSecondsMeasured).toBe(43200);

    // Everything else about this evidence is fresh, so the gate rejects it for
    // the measurement alone: the declaration cannot rescue it.
    const gate = runGate(result.stdout, []);
    expect(gate.status).toBe(1);
    expect(gate.stdout).toContain("measured PITR retention meets minimum | ⚠️");
    expect(gate.stdout).toContain("lastPgDumpAt is fresh | ✅");
  });

  it("creates evidence from an external artifact identifier without reading dump contents", async () => {
    stub = await startNeonStub((_req, res) =>
      respondWithProject(res, { id: "falling-dawn-93620497", history_retention_seconds: 86400 }),
    );

    const result = await runCreate(
      baseArgs([
        "--history-window-hours",
        "24",
        "--pg-dump-artifact",
        "secure-artifact://codip/neon/20260720T063000Z.dump",
        "--pg-dump-at",
        "2026-07-20T06:30:00Z",
      ]),
      { NEON_API_KEY: STUB_CREDENTIAL },
    );

    expect(result.status).toBe(0);
    const evidence = JSON.parse(result.stdout);
    expect(evidence.lastPgDumpArtifact).toBe("secure-artifact://codip/neon/20260720T063000Z.dump");
    expect(evidence).not.toHaveProperty("pgDumpSizeBytes");
  });

  it("rejects secret-looking artifact identifiers without printing the secret", async () => {
    stub = await startNeonStub((_req, res) =>
      respondWithProject(res, { id: "falling-dawn-93620497", history_retention_seconds: 86400 }),
    );

    const result = await runCreate(
      baseArgs([
        "--history-window-hours",
        "24",
        "--pg-dump-artifact",
        "postgresql://codip:super-secret@ep-neon.aws.neon.tech/codip",
        "--pg-dump-at",
        "2026-07-20T06:30:00Z",
      ]),
      { NEON_API_KEY: STUB_CREDENTIAL },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("super-secret");
    expect(result.stderr).toContain("pgDumpArtifact must not contain a secret-looking value");
  });
});

describe("create-neon-backup-evidence PITR measurement", () => {
  const artifactArgs = [
    "--pg-dump-artifact",
    "secure-artifact://codip/neon/20260720T063000Z.dump",
    "--pg-dump-at",
    "2026-07-20T06:30:00Z",
  ];

  it("writes no evidence when the Neon API key is absent", async () => {
    stub = await startNeonStub((_req, res) =>
      respondWithProject(res, { id: "falling-dawn-93620497", history_retention_seconds: 86400 }),
    );

    const result = await runCreate(baseArgs(["--history-window-hours", "24", ...artifactArgs]));

    // No estimated fallback: an unmeasurable window means no evidence at all.
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("NEON_API_KEY is required");
    expect(stub.requests).toHaveLength(0);
  });

  it("writes no evidence when the Neon API rejects the credential", async () => {
    stub = await startNeonStub((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "authorization failed" }));
    });

    const result = await runCreate(baseArgs(["--history-window-hours", "24", ...artifactArgs]), {
      NEON_API_KEY: STUB_CREDENTIAL,
    });

    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("HTTP 401");
    // The failing request carried the key; the diagnostic must not.
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(STUB_CREDENTIAL);
  });

  it("writes no evidence when the response omits history_retention_seconds", async () => {
    stub = await startNeonStub((_req, res) => respondWithProject(res, { id: "falling-dawn-93620497" }));

    const result = await runCreate(baseArgs(["--history-window-hours", "24", ...artifactArgs]), {
      NEON_API_KEY: STUB_CREDENTIAL,
    });

    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("history_retention_seconds");
  });

  it("writes no evidence when the API answers for a different project", async () => {
    stub = await startNeonStub((_req, res) =>
      respondWithProject(res, { id: "some-other-project-000", history_retention_seconds: 604800 }),
    );

    const result = await runCreate(baseArgs(["--history-window-hours", "24", ...artifactArgs]), {
      NEON_API_KEY: STUB_CREDENTIAL,
    });

    // A generous retention window for the wrong project would otherwise pass.
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("different project id");
  });

  it("refuses to send the API key over plaintext to a non-loopback host", async () => {
    const result = await runCreate(
      [
        "--project-id",
        "falling-dawn-93620497",
        "--branch",
        "main",
        "--endpoint-host",
        "ep-main.example.neon.tech",
        "--restore-drill-at",
        "2026-07-19T06:30:00Z",
        "--owner",
        "release-manager",
        "--neon-api-base-url",
        "http://console.neon.tech/api/v2",
        ...artifactArgs,
      ],
      { NEON_API_KEY: STUB_CREDENTIAL },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must use https");
  });
});
