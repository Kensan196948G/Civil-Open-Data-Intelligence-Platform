import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/check-neon-backup-evidence.js");

const freshEvidence = {
  checkedAt: "2026-07-20T07:00:00Z",
  projectId: "falling-dawn-93620497",
  branch: "main",
  endpointHost: "ep-main.example.neon.tech",
  historyWindowHours: 24,
  // Measured from the Neon control plane by create-neon-backup-evidence.js.
  // These four fields, not historyWindowHours, are what the gate judges.
  historyRetentionSecondsMeasured: 86400,
  historyRetentionMeasuredAt: "2026-07-20T07:00:00Z",
  historyRetentionProjectId: "falling-dawn-93620497",
  historyRetentionSource: "neon-api:GET /projects/{project_id}#history_retention_seconds",
  lastPgDumpAt: "2026-07-20T06:30:00Z",
  lastPgDumpStatus: "success",
  // Derived from a stat of the artifact, not from a flag: see Issue #127.
  lastPgDumpStatusSource: "artifact-stat:regular-file,size>0",
  lastPgDumpArtifact: "secure-artifact://codip/neon/20260720T063000Z.dump",
  lastRestoreDrillAt: "2026-07-19T06:30:00Z",
  restoreDrillStatus: "success",
  // This used to read ".../restore-drill-record.md#2026-07-19", an anchor that
  // has never existed in that file. The presence-only check accepted it, so the
  // fixture certified the defect instead of exposing it. The ledger is a table
  // with no per-row heading, so naming the file is the honest reference here;
  // anchor resolution is exercised against purpose-built fixtures below.
  restoreDrillRecord: "docs/runbooks/restore-drill-record.md",
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
    expect(result.stdout).toContain("measured PITR retention meets minimum | ✅");
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

  it("fails when restore drill evidence is stale", () => {
    const result = runGate({
      ...freshEvidence,
      lastRestoreDrillAt: "2026-06-01T00:00:00Z",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("lastRestoreDrillAt is fresh | ⚠️");
  });

  it("fails when the restore drill ran recently but did not succeed", () => {
    // Before Issue #127 this state was unreachable: the generator hardcoded
    // "success" and no caller could say otherwise, so a failed drill had no way
    // of reaching the gate at all.
    const result = runGate({ ...freshEvidence, restoreDrillStatus: "failed" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("restoreDrillStatus is success | ⚠️");
    expect(result.stdout).toContain("lastRestoreDrillAt is fresh | ✅");
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

describe("check-neon-backup-evidence PITR retention gate", () => {
  it("fails when the measured PITR retention is shorter than required", () => {
    const result = runGate({
      ...freshEvidence,
      historyWindowHours: 12,
      historyRetentionSecondsMeasured: 43200,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("measured PITR retention meets minimum | ⚠️");
    expect(result.stdout).toContain("12.00h measured (minimum 24h)");
  });

  it("fails when no measured retention is present at all", () => {
    // undefined is dropped by JSON.stringify, so the field is genuinely absent
    // from the document the gate parses.
    const result = runGate({ ...freshEvidence, historyRetentionSecondsMeasured: undefined });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historyRetentionSecondsMeasured present | ⚠️");
    expect(result.stdout).toContain("self-declared values are not accepted");
    // The absent measurement must not be quietly replaced by the sufficient
    // declaration that is still sitting in the same document.
    expect(result.stdout).not.toContain("measured PITR retention meets minimum | ✅");
  });

  it("cannot be passed by declaring a sufficient window when the measurement is short", () => {
    // This is the whole point of the change: before it, the workflow run passed
    // 24 on the command line and then graded its own answer. A generous
    // declaration must now be powerless.
    const result = runGate({
      ...freshEvidence,
      historyWindowHours: 720,
      historyWindowHoursDeclared: 720,
      historyRetentionSecondsMeasured: 3600,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("measured PITR retention meets minimum | ⚠️");
    expect(result.stdout).toContain("1.00h measured (minimum 24h)");
  });

  it("reports declaration drift without letting it change the verdict", () => {
    const result = runGate({
      ...freshEvidence,
      historyWindowHoursDeclared: 168,
    });

    // ℹ️ marks a non-gating row: the disagreement is visible, the run still passes.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("declared window agrees with measurement | ℹ️");
    expect(result.stdout).toContain("declared 168h vs measured 24.00h");
  });

  it("fails when the measurement is too old to still describe the project", () => {
    const result = runGate({
      ...freshEvidence,
      historyRetentionMeasuredAt: "2026-07-01T07:00:00Z",
    });

    // A measurement with no expiry decays into a slow-moving declaration.
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historyRetentionMeasuredAt is fresh | ⚠️");
  });

  it("fails when the measurement timestamp is missing or unparseable", () => {
    const result = runGate({
      ...freshEvidence,
      historyRetentionMeasuredAt: "not-a-date",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historyRetentionMeasuredAt ISO date | ⚠️");
  });

  it("fails when the retention was measured for a different project", () => {
    const result = runGate({
      ...freshEvidence,
      historyRetentionProjectId: "some-other-project-000",
    });

    // Otherwise a mistyped project id yields a green gate for a project that
    // nobody is backing up.
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historyRetentionProjectId matches projectId | ⚠️");
  });

  it("distinguishes a measured pg_dump status from a declared one without gating on it", () => {
    // Non-gating by design: the generator already refuses to emit evidence with
    // an unstated status, so failing here would only catch hand-forged JSON.
    // The row exists so a reader of the report can tell the two apart.
    const result = runGate({
      ...freshEvidence,
      lastPgDumpStatusSource: "declared:--pg-dump-status",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("lastPgDumpStatus was measured, not declared | ℹ️");
    expect(result.stdout).toContain("declared:--pg-dump-status");
  });

  it("fails when the measurement source is not recorded", () => {
    const result = runGate({
      ...freshEvidence,
      historyRetentionSource: "",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("historyRetentionSource present | ⚠️");
  });
});

// Issue #145 / T-B13. `restoreDrillRecord` used to be checked with
// `String(value).trim().length > 0`, which accepts any non-empty string. The
// value in production on 2026-08-12 named a file that exists and an anchor
// that does not, and the gate reported it as satisfied. These cases fix the
// distinction between "a reference was written down" and "the reference leads
// somewhere", against a real filesystem rather than a stubbed one.
describe("check-neon-backup-evidence restoreDrillRecord resolution", () => {
  let fixtureRoot = "";

  const LEDGER = [
    "# 🗄️ 復旧訓練 実施記録テンプレート",
    "",
    "## 1. 記録様式",
    "",
    "## 4. 記録台帳",
    "",
    "| 実施日時 | 判定 |",
    "| --- | --- |",
    '| <a id="drill-2026-08-12"></a>2026-08-12T00:00:00Z | success |',
    "",
    "## 1. 記録様式",
    "",
    "```text",
    "## 見出しではない",
    "```",
    "",
  ].join("\n");

  beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codip-drill-ref-"));
    fs.mkdirSync(path.join(fixtureRoot, "docs/runbooks"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "docs/runbooks/ledger.md"), LEDGER, "utf8");
    fs.writeFileSync(path.join(fixtureRoot, "outside.md"), "# outside\n", "utf8");
  });

  afterAll(() => {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function runAgainstFixture(restoreDrillRecord: unknown) {
    return runGate({ ...freshEvidence, restoreDrillRecord }, ["--repo-root", fixtureRoot]);
  }

  it("passes for an existing file and an anchor generated from a real heading", () => {
    const result = runAgainstFixture("docs/runbooks/ledger.md#4-記録台帳");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("restoreDrillRecord resolves | ✅");
    expect(result.stdout).toContain("#4-記録台帳 resolves");
  });

  it("passes for an explicit <a id> target, which is how an append-only table row can be addressed", () => {
    const result = runAgainstFixture("docs/runbooks/ledger.md#drill-2026-08-12");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("restoreDrillRecord resolves | ✅");
  });

  it("fails for an existing file with an anchor that resolves to nothing", () => {
    // The exact shape recorded in production: the file is real, the anchor is not.
    const result = runAgainstFixture("docs/runbooks/ledger.md#2026-08-12");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("restoreDrillRecord resolves | ⚠️");
    expect(result.stdout).toContain("has no anchor #2026-08-12");
  });

  it("fails for a file that does not exist in the repository", () => {
    const result = runAgainstFixture("docs/runbooks/absent.md#4-記録台帳");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("does not exist in the repository");
  });

  it("fails for an empty or whitespace-only reference", () => {
    for (const value of ["", "   "]) {
      const result = runAgainstFixture(value);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("restoreDrillRecord resolves | ⚠️");
      expect(result.stdout).toContain("(not recorded)");
    }
  });

  it("fails when the field is absent altogether", () => {
    // undefined is dropped by JSON.stringify, so the key is genuinely missing.
    const result = runAgainstFixture(undefined);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("restoreDrillRecord resolves | ⚠️");
  });

  it("fails for a bare anchor with no file path", () => {
    const result = runAgainstFixture("#4-記録台帳");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("has no file path");
  });

  it("accepts a file-only reference, because the ledger has no per-row heading", () => {
    // Deliberate: requiring an anchor would force the append-only table into a
    // date-heading layout, which means rewriting rows the ledger forbids
    // rewriting. Naming the file is the strongest honest reference available.
    const result = runAgainstFixture("docs/runbooks/ledger.md");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("exists (no anchor supplied)");
  });

  it("fails for a directory, an absolute path, and a path escaping the repository", () => {
    expect(runAgainstFixture("docs/runbooks").status).toBe(1);
    expect(runAgainstFixture("docs/runbooks").stdout).toContain("is not a regular file");

    const absolute = runAgainstFixture(path.join(fixtureRoot, "docs/runbooks/ledger.md"));
    expect(absolute.status).toBe(1);
    expect(absolute.stdout).toContain("must be repository-relative");

    const escaping = runAgainstFixture("../outside.md");
    expect(escaping.status).toBe(1);
    expect(escaping.stdout).toContain("escapes the repository root");
  });

  it("does not treat a '#' line inside a fenced code block as a heading", () => {
    const result = runAgainstFixture("docs/runbooks/ledger.md#見出しではない");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("has no anchor");
  });

  it("reproduces GitHub's slug quirks: duplicate suffixes and emoji-leading hyphens", () => {
    // A repeated heading takes "-1"; an emoji-prefixed heading keeps the
    // leading hyphen left behind when the emoji is stripped. Getting either
    // wrong would reject an anchor that resolves in the rendered document.
    expect(runAgainstFixture("docs/runbooks/ledger.md#1-記録様式-1").status).toBe(0);
    expect(runAgainstFixture("docs/runbooks/ledger.md#-復旧訓練-実施記録テンプレート").status).toBe(0);
  });

  it("resolves a percent-encoded anchor, which is how a browser copies a CJK link", () => {
    const result = runAgainstFixture(
      `docs/runbooks/ledger.md#${encodeURIComponent("4-記録台帳")}`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("restoreDrillRecord resolves | ✅");
  });
});

describe("check-neon-backup-evidence against the real repository", () => {
  it("rejects the reference that was recorded as evidence on 2026-08-12", () => {
    // Not a fixture: this is the value held in the repository variable
    // CODIP_LAST_RESTORE_DRILL_RECORD, judged against the checked-out tree.
    // It must fail. If this test ever goes green without the ledger gaining a
    // matching anchor, the anchor comparison has been loosened.
    const result = runGate({
      ...freshEvidence,
      restoreDrillRecord: "docs/runbooks/restore-drill-record.md#2026-08-12",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("restoreDrillRecord resolves | ⚠️");
    expect(result.stdout).toContain("has no anchor #2026-08-12");
  });
});
