import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/check-dependency-audit.js");
const require = createRequire(import.meta.url);
const { evaluateAudit } = require(scriptPath);

const ALLOWLISTED_GHSA = "GHSA-mh99-v99m-4gvg";

function auditReport(via: Array<Record<string, unknown>>) {
  return {
    vulnerabilities: {
      "some-package": { via },
    },
    metadata: { vulnerabilities: { moderate: 0, high: via.length, critical: 0 } },
  };
}

function writeReport(report: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "codip-audit-"));
  const file = path.join(dir, "audit.json");
  writeFileSync(file, JSON.stringify(report));
  return file;
}

function runCli(reportFile: string) {
  return spawnSync("node", [scriptPath, "--input", reportFile], { encoding: "utf8" });
}

describe("dependency audit allowlist gate", () => {
  it("passes when every blocking advisory is allowlisted and unexpired", () => {
    const file = writeReport(
      auditReport([
        {
          url: `https://github.com/advisories/${ALLOWLISTED_GHSA}`,
          severity: "high",
          name: "brace-expansion",
          title: "OOM DoS",
        },
      ]),
    );
    const result = runCli(file);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`allowlisted: ${ALLOWLISTED_GHSA}`);
    expect(result.stdout).toContain("[dependency-audit] OK");
  });

  it("fails on an advisory that is not allowlisted", () => {
    const file = writeReport(
      auditReport([
        {
          url: "https://github.com/advisories/GHSA-0000-0000-0000",
          severity: "critical",
          name: "evil-package",
          title: "RCE",
        },
      ]),
    );
    const result = runCli(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unallowlisted critical advisory GHSA-0000-0000-0000");
  });

  it("fails when the report is unreadable instead of passing silently", () => {
    const result = spawnSync("node", [scriptPath, "--input", "/nonexistent/audit.json"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[dependency-audit] FAIL");
  });

  it("fails when counts show vulnerabilities but no advisory details parse", () => {
    const file = writeReport({
      vulnerabilities: { opaque: { via: ["chain-only-string"] } },
      metadata: { vulnerabilities: { moderate: 0, high: 3, critical: 0 } },
    });
    const result = runCli(file);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no advisory details could be parsed");
  });

  it("treats an expired allowlist entry as a failure (pure evaluation)", () => {
    const report = auditReport([
      {
        url: `https://github.com/advisories/${ALLOWLISTED_GHSA}`,
        severity: "high",
        name: "brace-expansion",
        title: "OOM DoS",
      },
    ]);
    const allowlist = [
      {
        ghsa: ALLOWLISTED_GHSA,
        severity: "high",
        scope: "devDependencies",
        reason: "test",
        tracking: "Issue #82",
        owner: "Kensan196948G",
        expires: "2026-01-01T00:00:00Z",
      },
    ];
    const { errors } = evaluateAudit(report, allowlist, "2026-07-27T00:00:00Z");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("expired");
    expect(errors[0]).toContain("Issue #82");
  });

  it("fails when a parseable audit execution error is reported", () => {
    const { errors } = evaluateAudit(
      { error: { code: "EAUDITNOLOCK", summary: "registry unavailable" } },
      [],
      "2026-07-27T00:00:00Z",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("npm audit failed");
    expect(errors[0]).toContain("EAUDITNOLOCK");
    expect(errors[0]).toContain("registry unavailable");
  });

  it("fails on an expired allowlist entry even when no advisory is detected", () => {
    const { errors } = evaluateAudit(
      { vulnerabilities: {}, metadata: { vulnerabilities: {} } },
      [
        {
          ghsa: ALLOWLISTED_GHSA,
          severity: "high",
          scope: "devDependencies",
          reason: "test",
          tracking: "Issue #82",
          owner: "Kensan196948G",
          expires: "2026-01-01T00:00:00Z",
        },
      ],
      "2026-07-27T00:00:00Z",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("expired");
  });

  it("ignores low severity advisories without allowlist entries", () => {
    const { errors } = evaluateAudit(
      auditReport([
        {
          url: "https://github.com/advisories/GHSA-low-low-low",
          severity: "low",
          name: "minor-package",
          title: "cosmetic",
        },
      ]),
      [],
      "2026-07-27T00:00:00Z",
    );
    expect(errors).toHaveLength(0);
  });
});
