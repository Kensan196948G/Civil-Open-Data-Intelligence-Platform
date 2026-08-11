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
const smokeWorkflow = read(".github/workflows/production-smoke.yml");
const postReleaseStatus = read("scripts/tools/post-release-status.js");

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
});

describe("probe script contract", () => {
  it("monitors the endpoints listed in runbook section 1", () => {
    const productionPaths = postReleaseStatus.match(/const PRODUCTION_PATHS = \[([^\]]*)\]/)?.[1] ?? "";
    expect(productionPaths).toContain("/api/health");
    expect(productionPaths).toContain("/api/ready");
  });

  it("has no cross-run state, matching the documented implementation gap", () => {
    // Runbook section 1 states that "連続2回以上" is not machine-evaluated.
    // That claim holds only while the probe exits per run without persisting history.
    expect(postReleaseStatus).toMatch(/process\.exit\(1\)/);
    expect(monitoringRunbook).toContain("run間の連続失敗回数を保持しない");
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

describe("operational runbooks contain no credentials", () => {
  const runbooks = {
    "monitoring.md": monitoringRunbook,
    "notification-test-record.md": notificationRecord,
    "alerts-and-notifications.md": alertsRunbook,
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
