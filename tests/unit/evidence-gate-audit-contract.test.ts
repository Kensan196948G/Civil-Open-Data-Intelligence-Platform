import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract tests for docs/security/evidence-gate-audit.md.
 *
 * The audit classifies every CI evidence gate by who supplies the value it
 * checks. Two failure modes make such a document dangerous rather than merely
 * stale:
 *
 *   1. A row claims a gate is unfailable, backend fixes the gate, and the
 *      document keeps advertising a hole that no longer exists (or worse, the
 *      reverse: a gate regresses and the document still calls it measured).
 *   2. A classification carries no filename:line, so a reader cannot check it.
 *
 * These tests bind the document's claims to the implementation it describes.
 * They are expected to fail when backend lands the remediation listed in
 * section 4 — that failure is the signal to update the document, not a defect.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const auditDoc = read("docs/security/evidence-gate-audit.md");
const createBackupEvidence = read("scripts/tools/create-neon-backup-evidence.js");
const checkBackupEvidence = read("scripts/tools/check-neon-backup-evidence.js");
const neonBackupWorkflow = read(".github/workflows/neon-backup.yml");
const productionEvidenceReport = read("scripts/tools/production-evidence-report.js");
const validateProductionTargetEnv = read("scripts/tools/validate-production-target-env.js");

/** Markdown cells may contain escaped pipes; park them before splitting. */
const ESCAPED_PIPE = "¦";

type GateRow = {
  id: string;
  name: string;
  source: string;
  classification: string;
  falseNegative: string;
  remediation: string;
  raw: string;
};

const gateRows: GateRow[] = auditDoc
  .split("\n")
  .filter((line) => line.trimStart().startsWith("|"))
  .map((line) => {
    const cells = line
      .replace(/\\\|/g, ESCAPED_PIPE)
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replace(new RegExp(ESCAPED_PIPE, "g"), "|").trim());
    return { cells, line };
  })
  // Only the section 2 gate tables are numbered; the summary and legend tables
  // in sections 0 and 1 also contain the emoji, so numbering is the selector.
  .filter(({ cells }) => cells.length >= 6 && /^\d+$/.test(cells[0]))
  .map(({ cells, line }) => ({
    id: cells[0],
    name: cells[1],
    source: cells[2],
    classification: cells[3],
    falseNegative: cells[4],
    remediation: cells[5],
    raw: line,
  }));

describe("evidence gate audit table structure", () => {
  it("parses every numbered gate row", () => {
    expect(gateRows.length).toBeGreaterThanOrEqual(20);
  });

  it("assigns each gate exactly one known classification", () => {
    const known = ["🟢", "🟡", "🔴", "⬜"];
    for (const row of gateRows) {
      const matched = known.filter((symbol) => row.classification.includes(symbol));
      expect(matched, `gate #${row.id} classification: ${row.classification}`).toHaveLength(1);
    }
  });

  it("numbers gates uniquely", () => {
    const ids = gateRows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the section 0.1 summary counts equal to the section 2 rows", () => {
    // A hand-counted summary drifts from the table it summarises, and the
    // summary is what gets quoted. Derive both and compare.
    const actual = {
      "🟢": gateRows.filter((row) => row.classification.includes("🟢")).length,
      "🟡": gateRows.filter((row) => row.classification.includes("🟡")).length,
      "🔴": gateRows.filter((row) => row.classification.includes("🔴")).length,
    };

    for (const [symbol, count] of Object.entries(actual)) {
      expect(auditDoc, `summary row for ${symbol}`).toMatch(
        new RegExp(`\\|\\s*${symbol}[^|]*\\|\\s*${count}\\s*\\|`),
      );
    }

    expect(auditDoc).toContain(`全 ${gateRows.length} ゲートを分類した`);
  });
});

describe("classifications are traceable to source", () => {
  const citation = /[\w.-]+\.(?:js|ts|yml|jsonc|md):\d+/;

  it.each(gateRows.filter((row) => !row.classification.includes("🟢")))(
    "gate #$id cites a filename:line in its supplier column",
    (row) => {
      // 🔴/🟡 are the claims a reader must be able to re-derive, and what they
      // must re-derive is the *supplier*. Requiring the citation anywhere in
      // the row would let an unrelated citation in the remediation column
      // stand in for a missing one here.
      expect(citation.test(row.source), `gate #${row.id} supplier: ${row.source}`).toBe(true);
    },
  );

  it("uses 未確認 rather than a guessed classification", () => {
    // The audit brief required "probably measured" to be recorded as 未確認.
    // If a ⬜ row ever appears, the document must still explain the gap.
    const unverified = gateRows.filter((row) => row.classification.includes("⬜"));
    for (const row of unverified) {
      expect(row.source, `gate #${row.id}`).not.toBe("—");
    }
  });
});

describe("neon backup gate claims match the implementation", () => {
  it("keeps the 'structurally unfailable' claim true only while it is", () => {
    // The document's sharpest claim: restoreDrillStatus defaults to "success"
    // in the generator and no workflow ever overrides it, so the checker's
    // assertion cannot fail. Both halves must hold for the claim to stand.
    const generatorHardcodesSuccess = /restoreDrillStatus:\s*"success"/.test(createBackupEvidence);
    const workflowOverridesIt = /--restore-drill-status/.test(neonBackupWorkflow);
    const gateCannotFail = generatorHardcodesSuccess && !workflowOverridesIt;

    const docSaysCannotFail = auditDoc.includes("構造的に失敗し得ない検査");

    expect(gateCannotFail).toBe(docSaysCannotFail);
  });

  it("keeps the same claim for lastPgDumpStatus", () => {
    const generatorHardcodesSuccess = /pgDumpStatus:\s*"success"/.test(createBackupEvidence);
    const workflowOverridesIt = /--pg-dump-status/.test(neonBackupWorkflow);

    const docListsBothAsSelfDeclared = auditDoc.includes("`lastPgDumpStatus is success`");

    expect(generatorHardcodesSuccess && !workflowOverridesIt).toBe(docListsBothAsSelfDeclared);
  });

  it("still asserts both statuses, so the rows describe live checks", () => {
    // If backend deletes these assertions instead of sourcing real values, the
    // rows above describe gates that no longer exist. Fail so they get pruned.
    expect(checkBackupEvidence).toContain("lastPgDumpStatus is success");
    expect(checkBackupEvidence).toContain("restoreDrillStatus is success");
  });

  it("keeps the pg_dump artifact measurement recorded as the one 🟢 in the family", () => {
    // Row #5 credits statSync on the dump file. That is the only thing in the
    // backup family with a real measurement behind it.
    expect(createBackupEvidence).toMatch(/statSync/);
    expect(auditDoc).toContain("同一スクリプト内で唯一の実測経路");
  });

  it("keeps the restore drill date sourced from dispatch input", () => {
    const fromDispatch = /restore_drill_at|CODIP_LAST_RESTORE_DRILL_AT/.test(neonBackupWorkflow);
    expect(fromDispatch).toBe(true);
    expect(auditDoc).toContain("復旧訓練を実施していなくても");
  });
});

describe("production evidence variables match the audited list", () => {
  const monitoringKeys = [
    ...(productionEvidenceReport.match(/const MONITORING_ENV_KEYS = \[([\s\S]*?)\]/)?.[1] ?? "")
      .matchAll(/"([A-Z0-9_]+)"/g),
  ].map((match) => match[1]);

  it("finds the key list in the report script", () => {
    expect(monitoringKeys.length).toBeGreaterThan(0);
  });

  it.each(monitoringKeys)("documents %s in the audit", (key) => {
    // Adding an evidence variable without auditing its supplier is exactly how
    // this class of gate accumulated. Force the document to grow with the list.
    expect(auditDoc).toContain(key);
  });

  it("states the same count as the implementation", () => {
    expect(auditDoc).toContain(`Monitoring evidence ${monitoringKeys.length}項目`);
  });

  /**
   * Row #7's leniency claim must track what the monitoring rows actually go
   * through, not what one named function contains.
   *
   * The earlier version of this test probed `evidenceState` for an external
   * call and required the doc to keep the `ok` claim while none was found.
   * That proxy is wrong in a way backend caught: e199e64 keeps `evidenceState`
   * as a deliberate presence check and moves the rows onto a per-key format
   * validator. No external call is ever added, so the proxy would have pinned
   * the document to a claim that had become false. Measure the row path.
   */
  const monitoringRowChecker = () => {
    const rowLine = productionEvidenceReport.match(/const monitoringRows = [\s\S]*?\n/)?.[0] ?? "";
    const called = /\[key, (\w+)\(/.exec(rowLine)?.[1];
    if (!called) return { tier: "unknown", called } as const;

    const body =
      productionEvidenceReport.match(new RegExp(`function ${called}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    if (/fetch\(|spawnSync|execSync|https?:\/\//.test(body)) return { tier: "probed", called } as const;
    // A per-key expectation table means "ok" no longer satisfies every key
    if (/EVIDENCE_FORMATS|\bspec\b|\.pattern\b|RegExp/.test(body)) return { tier: "format-validated", called } as const;
    return { tier: "presence-only", called } as const;
  };

  it("resolves how the monitoring rows are actually built", () => {
    // If this stops resolving, the tier below silently degrades to one value
    // and the claim check turns into a constant. Fail loudly instead.
    const { tier, called } = monitoringRowChecker();
    expect(called, "monitoringRows の構築行から判定関数を解決できない").toBeDefined();
    expect(tier).not.toBe("unknown");
  });

  it("carries the `ok` leniency claim only while the rows are presence-only", () => {
    const { tier } = monitoringRowChecker();
    const docSaysStringOnly = auditDoc.includes(
      "GitHub Variables に `ok` の2文字を入れれば7項目すべてが ✅ になる",
    );

    expect(
      docSaysStringOnly,
      tier === "presence-only"
        ? "行は今も存在確認だけなので、この主張を消してはならない"
        : `行は ${tier} へ強化されている。docs/security/evidence-gate-audit.md 行#7 の ` +
          "「`ok` の2文字で7項目すべてが ✅」は既に偽なので、実際の判定内容へ書き換えること",
    ).toBe(tier === "presence-only");
  });
});

describe("recorded positive patterns still exist", () => {
  it("keeps the production hostname pinned to a constant", () => {
    // Section 3.3 recommends this as the template for fixing the 🔴 rows. If it
    // disappears, the recommendation points at nothing.
    expect(validateProductionTargetEnv).toContain("PRODUCTION_BASE_HOSTNAME");
    expect(auditDoc).toContain("期待値のピン留め");
  });

  it("keeps the dependency allowlist time-limited", () => {
    const dependencyAudit = read("scripts/tools/check-dependency-audit.js");
    const hasExpiry = /expires\s*:/.test(dependencyAudit);
    const docCitesItAsGoodPattern = auditDoc.includes("時限付き allowlist");
    expect(hasExpiry).toBe(docCitesItAsGoodPattern);
  });
});

describe("audit document safety", () => {
  const secretPatterns: Array<[string, RegExp]> = [
    ["database connection string with credentials", /postgres(?:ql)?:\/\/[^\s`"']*:[^\s`"']*@/i],
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["bearer token", /\bBearer\s+[A-Za-z0-9._-]{20,}/],
    [
      "inline secret assignment",
      /\b(?:secret|token|passphrase|password)\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/i,
    ],
  ];

  it.each(secretPatterns)("contains no %s", (_label, pattern) => {
    expect(auditDoc).not.toMatch(pattern);
  });

  it("cross-references the monitoring runbook it extends", () => {
    expect(auditDoc).toContain("runbooks/monitoring.md");
  });
});
