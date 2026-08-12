import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract tests between the monitoring runbook and the automation it describes.
 *
 * The runbook is an operational source of truth: if it drifts from the workflow
 * or the probe script, on-call decisions are made against a document that no
 * longer matches reality. These tests fail when the two move apart.
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const monitoringRunbook = read("docs/runbooks/monitoring.md");
const notificationRecord = read("docs/runbooks/notification-test-record.md");
const alertsRunbook = read("docs/runbooks/alerts-and-notifications.md");
const operationsLedger = read("docs/operations/operations-ledger.md");
const smokeWorkflow = read(".github/workflows/production-smoke.yml");
const postReleaseStatus = read("scripts/tools/post-release-status.js");
const createBackupEvidence = read("scripts/tools/create-neon-backup-evidence.js");
const checkBackupEvidence = read("scripts/tools/check-neon-backup-evidence.js");

describe("monitoring runbook structure", () => {
  const requiredSections = [
    "## 0.1 監視実態の read-only 再検証",
    "### 0.1.1 確認できた事実",
    "### 0.1.2 BLOCKED",
    "### 0.1.3 未整備",
    "## 1. 監視対象",
    "## 1.1 アラート運用",
    "### 1.1.1 定期production smoke",
    "### 1.1.2 SLO目標",
    "### 1.1.3 通知テスト記録",
    "### 1.1.4 backend への変更仕様",
    "### 1.2 Neon backup鮮度ゲート",
    "#### 1.2.1 PITR retention とゲート閾値の関係",
  ];

  it.each(requiredSections)("keeps the %s section", (heading) => {
    expect(monitoringRunbook).toContain(heading);
  });

  it("separates verified facts from blocked and unimplemented items", () => {
    // A monitoring runbook that cannot express "we could not check this" will
    // silently turn unverified items into apparent successes.
    expect(monitoringRunbook).toContain("BLOCKED（権限不足）");
    expect(monitoringRunbook).toContain("未整備");
  });

  it("links the notification test record template", () => {
    expect(monitoringRunbook).toContain("notification-test-record.md");
  });
});

describe("production smoke workflow contract", () => {
  const cronMinutes = smokeWorkflow.match(/cron:\s*"([\d,]+) \* \* \* \*"/)?.[1]?.split(",") ?? [];

  it("runs on a schedule", () => {
    expect(cronMinutes.length).toBeGreaterThan(0);
  });

  it.each(cronMinutes)("documents scheduled minute %s in the runbook", (minute) => {
    expect(monitoringRunbook).toMatch(new RegExp(`${minute}\\s*[/、]|${minute}分`));
  });

  it("documents the artifact retention period actually configured", () => {
    const retention = smokeWorkflow.match(/retention-days:\s*(\d+)/)?.[1];
    expect(retention).toBeDefined();
    expect(monitoringRunbook).toContain(`${retention}日保持artifact`);
  });

  it("probes the production URL the runbook names", () => {
    expect(smokeWorkflow).toContain("https://odip.mirai-dx-platform.com");
    expect(monitoringRunbook).toContain("odip.mirai-dx-platform.com");
  });

  it("keeps strict production judgement enabled", () => {
    // Without --strict-production the workflow reports "not connected" as a pass,
    // which would make the SLO in runbook 1.1.2 unmeasurable.
    expect(smokeWorkflow).toContain("--strict-production");
  });

  it("fails the run when readiness fails", () => {
    expect(smokeWorkflow).toMatch(/if:\s*steps\.production-status\.outcome == 'failure'/);
    expect(smokeWorkflow).toContain("exit 1");
  });

  it("keeps the runbook honest about whether a failure notification exists", () => {
    // Keyword scan for an actual notification path: chat webhook, mail, or issue
    // creation. `exit 1` alone only produces GitHub's per-user default email.
    const hasNotificationStep = /github-script|webhook|slack|teams|notify|create-issue|mailto/i.test(
      smokeWorkflow,
    );
    const runbookClaimsUnimplemented = monitoringRunbook.includes(
      "`production-smoke.yml` に失敗時の通知step・Issue起票step・webhookのいずれも存在せず",
    );

    // Exactly one of these must hold. If backend implements the notification,
    // this test fails until the runbook stops describing it as 未整備.
    expect(hasNotificationStep).toBe(!runbookClaimsUnimplemented);
  });

  it("escalates to P1 only on a repeated failure, as runbook section 1 defines", () => {
    // A notification that always shouts P1 trains on-call to ignore it.
    expect(smokeWorkflow).toMatch(/consecutiveFailures\s*>=\s*2\s*\?\s*"P1"\s*:\s*"P2"/);
    expect(monitoringRunbook).toContain("連続2回以上");
  });

  it("derives the streak from run history rather than persisted state", () => {
    // Option B (see runbook 1.1.4): GitHub's run history is the single source of
    // truth. State written by the workflow would be skipped whenever a run is
    // cancelled or times out, and the rot would only surface during an incident.
    expect(smokeWorkflow).toContain("listWorkflowRuns");
    expect(smokeWorkflow).not.toMatch(/actions\.(createRepositoryVariable|updateRepositoryVariable)/);
  });

  it("still files the incident when the run history cannot be read", () => {
    // The notification is the safety net; losing it because a secondary API call
    // failed is worse than reporting an unknown streak.
    // The test path initialises the streak to 1, real failures to null; both
    // must still attempt the history read inside a try/catch.
    expect(smokeWorkflow).toMatch(
      /let consecutiveFailures = isNotificationTest \? 1 : null;[\s\S]*?try \{[\s\S]*?\} catch/,
    );
  });

  it("does not depend on labels having been registered by hand", () => {
    // None of incident / production-smoke / P1 / P2 existed in the repository
    // when this was written. Requiring manual setup means the omission is
    // discovered during an outage, so the workflow creates them idempotently.
    expect(smokeWorkflow).toContain("createLabel");
    expect(smokeWorkflow).toMatch(/error\.status !== 422/);
    expect(monitoringRunbook).toContain("workflowが起票前に冪等作成する");
  });

  it("pins the notification action to a full commit SHA", () => {
    const pinned = smokeWorkflow.match(/uses:\s*actions\/github-script@(\S+)/)?.[1];
    expect(pinned).toMatch(/^[0-9a-f]{40}$/);
  });

  it("grants the job only the permissions the notification needs", () => {
    // An explicit permissions block sets every unlisted scope to none, so
    // actions:read must be present or the streak lookup 403s.
    const jobPermissions = smokeWorkflow.match(/^    permissions:\n((?:^ {6}\S.*\n)+)/m)?.[1] ?? "";
    const scopes = jobPermissions.trim().split("\n").map((line) => line.trim());
    expect(new Set(scopes)).toEqual(new Set(["contents: read", "actions: read", "issues: write"]));
  });

  it("introduces no notification secret beyond the existing Access token", () => {
    // Adding a webhook destination secret is an Approval PR matter (CLAUDE.md
    // §17), not something the notification step may grow into silently.
    const referenced = new Set([...smokeWorkflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
    expect(referenced).toEqual(new Set(["CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]));
  });

  it("keeps probe output out of the issue body", () => {
    // production-status.md may contain response bodies and headers; it belongs in
    // the redacted artifact, not in a world-readable issue.
    const notificationStep = smokeWorkflow.slice(smokeWorkflow.indexOf("github-script@"));
    expect(notificationStep).not.toContain("production-status.md");
  });
});

describe("probe script contract", () => {
  it("monitors the endpoints listed in runbook section 1", () => {
    const productionPaths = postReleaseStatus.match(/const PRODUCTION_PATHS = \[([^\]]*)\]/)?.[1] ?? "";
    expect(productionPaths).toContain("/api/health");
    expect(productionPaths).toContain("/api/ready");
  });

  it("stays per-run, leaving streak judgement to the workflow", () => {
    // The probe deliberately holds no cross-run state: runbook section 1 places
    // the "連続2回以上" judgement in the workflow, which reads GitHub's own run
    // history. If the probe ever starts persisting streaks, the two would
    // disagree about which one is authoritative.
    expect(postReleaseStatus).toMatch(/process\.exit\(1\)/);
    expect(postReleaseStatus).not.toMatch(/listWorkflowRuns/);
    expect(monitoringRunbook).toContain("GitHubのrun履歴から連続失敗回数を判定する");
  });
});

describe("neon backup evidence gate contract", () => {
  it("keeps the documented default minimum in sync with the gate implementation", () => {
    const minimum = checkBackupEvidence.match(
      /DEFAULT_MIN_HISTORY_WINDOW_HOURS\s*=\s*(\d+)/,
    )?.[1];
    expect(minimum).toBeDefined();
    expect(monitoringRunbook).toContain(`historyWindowHours >= ${minimum}`);
  });

  it("keeps the runbook honest about the gate comparing constants", () => {
    // Runbook 1.2.1(4) states the gate never reads the real retention value from
    // Neon, which makes a shortened history window undetectable. That claim holds
    // only while the evidence scripts make no Neon API call at all.
    const scriptsReadNeonApi = /neon\.tech|api\/v2\/projects|history_retention_seconds/.test(
      createBackupEvidence + checkBackupEvidence,
    );
    const runbookClaimsNoMeasurement = monitoringRunbook.includes(
      "`historyWindowHours` の値は Neon API から取得されていない",
    );

    // Exactly one must hold. Once backend sources the value from the API,
    // this fails until 1.2.1 stops describing the gate as tautological.
    expect(scriptsReadNeonApi).toBe(!runbookClaimsNoMeasurement);
  });

  it("records the measured retention rather than only the plan maximum", () => {
    // Both numbers matter: 86400 is what production actually has, 604800 is what
    // the Launch plan permits. Documenting only one hides the available headroom.
    expect(monitoringRunbook).toContain("86400");
    expect(monitoringRunbook).toContain("604800");
  });
});

describe("operations ledger reflects the monitoring verification", () => {
  it("no longer describes P1 detection as merely an unconfigured alert", () => {
    expect(operationsLedger).not.toContain("アラート（未設定）");
    expect(operationsLedger).toContain("計測不能");
  });

  it("cross-references the notification test record", () => {
    expect(operationsLedger).toContain("notification-test-record.md");
  });

  it("states the measured PITR retention instead of an unqualified 24h", () => {
    expect(operationsLedger).toContain("history_retention_seconds=86400");
  });
});

describe("notification test record template", () => {
  const requiredColumns = [
    "実施日時 (UTC)",
    "対象経路",
    "テスト方法",
    "送信結果",
    "受信確認者",
    "受信時刻 (UTC)",
    "判定",
    "根拠",
  ];

  it.each(requiredColumns)("requires the %s column", (column) => {
    expect(notificationRecord).toContain(column);
  });

  it("defines every verdict value used by the ledger", () => {
    for (const verdict of ["PASS", "FAIL", "BLOCKED", "NOT RUN"]) {
      expect(notificationRecord).toContain(verdict);
    }
  });

  it("forbids recording secrets and PII in the evidence ledger", () => {
    expect(notificationRecord).toContain("記入禁止事項");
    expect(notificationRecord).toMatch(/Webhook URL/);
  });

  it("judges a notification path on human receipt, not on send success", () => {
    expect(notificationRecord).toContain("受信確認者が受信時刻を記入できた");
  });
});

describe("dispatch-only notification test path", () => {
  it("exposes a workflow_dispatch input instead of failing the production probe", () => {
    expect(smokeWorkflow).toContain("run_notification_test");
    expect(smokeWorkflow).toContain("workflow_dispatch:");
    // The notification step fires on a real failure OR the dispatch-only test
    // input; the production probe is never degraded for the test.
    expect(smokeWorkflow).toContain(
      "if: failure() || github.event.inputs.run_notification_test == 'true'",
    );
  });

  it("marks test incidents so they cannot be confused with real failures", () => {
    const script = smokeWorkflow.slice(smokeWorkflow.indexOf("github-script@"));
    expect(script).toContain("isNotificationTest");
    expect(script).toContain("production-smoke-test");
    expect(script).toContain("[TEST] ");
  });

  it("documents the dispatch-only test method in the runbooks", () => {
    expect(alertsRunbook).toContain("run_notification_test=true");
    expect(notificationRecord).toContain("run_notification_test=true");
    // 本番probeを故意に落とす旧方式が現行手順として残っていないこと
    expect(alertsRunbook).not.toContain("意図的失敗run");
  });
});

describe("operational runbooks contain no credentials", () => {
  const runbooks = {
    "monitoring.md": monitoringRunbook,
    "notification-test-record.md": notificationRecord,
    "alerts-and-notifications.md": alertsRunbook,
    "operations-ledger.md": operationsLedger,
  };

  const secretPatterns: Array<[string, RegExp]> = [
    ["database connection string with credentials", /postgres(?:ql)?:\/\/[^\s`"']*:[^\s`"']*@/i],
    ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["bearer token", /\bBearer\s+[A-Za-z0-9._-]{20,}/],
    [
      "inline secret assignment",
      /\b(?:secret|token|passphrase|password)\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/i,
    ],
  ];

  for (const [name, content] of Object.entries(runbooks)) {
    it.each(secretPatterns)(`${name} has no %s`, (_label, pattern) => {
      expect(content).not.toMatch(pattern);
    });
  }
});
