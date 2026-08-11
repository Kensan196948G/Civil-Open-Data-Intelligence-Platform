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
    expect(smokeWorkflow).toMatch(/let consecutiveFailures = null;[\s\S]*?try \{[\s\S]*?\} catch/);
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

  it("documents every permission the job actually holds", () => {
    // 権限表から actions:read が抜けていると、読んだ人が「不要な権限」と判断して
    // 削れる。削れば連続失敗判定が403で落ちるが、落ちるのは障害発生時である。
    const jobPermissions = smokeWorkflow.match(/^    permissions:\n((?:^ {6}\S.*\n)+)/m)?.[1] ?? "";
    const scopes = jobPermissions.trim().split("\n").map((line) => line.trim());
    // 照合先は列挙部分（「job権限は … の N つ」）に限定する。行全体を
    // toContain で見ると、同じ行の解説文に scope 名が出てくるだけで通ってしまい、
    // 列挙から抜けていても緑になる。文言の部分一致で網羅を主張しない。
    const enumerated = monitoringRunbook.match(/job権限は(.+?)の\d+つ/)?.[1] ?? "";
    const documented = [...enumerated.matchAll(/`([a-z-]+: [a-z]+)`/g)].map((match) => match[1]);
    expect(scopes.length).toBeGreaterThan(0);
    // 集合比較にして、抜けだけでなく実在しない権限の記載も落とす。
    expect(new Set(documented)).toEqual(new Set(scopes));
  });

  it("keeps the alerts runbook in step with the notification actually implemented", () => {
    // 通知経路の記述が2つのrunbookで食い違うと、片方だけを読んだ人が
    // 「通知は無い」または「通知は届く」と誤って判断する。どちらも危険。
    const implemented = smokeWorkflow.includes("github-script@");
    expect(alertsRunbook.includes("incident")).toBe(implemented);
    // 実装済みでも「人へ届く」ことは別問題。到達側が未確定である事実を落とさない。
    expect(alertsRunbook).toContain("watcher");
  });

  it("does not describe a notification test the workflow cannot perform", () => {
    // 通知stepは probe 非成功でのみ発火する。workflow_dispatch の成功実行では
    // 発火しないので、「dispatchで通知経路だけ試す」手順は実行できない。
    // 書けるが実行できない手順は、障害時に試して時間を失う原因になる。
    const activeTestClaim = /`workflow_dispatch` で通知経路のみを試す/.test(monitoringRunbook);
    expect(activeTestClaim).toBe(false);
    expect(monitoringRunbook).toContain("能動的に行う手順は、現時点で存在しない");
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

/**
 * `script: |` の中身をインデント規則だけで取り出す。
 *
 * YAMLパーサを使わないのは、`yaml` がこのリポジトリの宣言依存ではなく、
 * 今は推移的に解決できているだけだからである。依存ツリーが変わった時に
 * このテストが静かに落ちる（あるいは消える）経路を作らない。
 */
const extractNotificationScript = (workflow: string): string => {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => /^\s*script: \|\s*$/.test(line));
  if (start < 0) throw new Error("notification step has no `script: |` block");
  const bodyIndent = (lines[start + 1].match(/^ */)?.[0] ?? "").length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if ((line.match(/^ */)?.[0] ?? "").length < bodyIndent) break;
    body.push(line.slice(bodyIndent));
  }
  return body.join("\n");
};

type FakeItem = {
  number: number;
  labels?: Array<string | { name: string }>;
  pull_request?: Record<string, unknown>;
};

type Params = Record<string, unknown>;

const runNotification = async (options: {
  probeOutcome: string;
  openItems?: FakeItem[];
  history?: Array<{ id: number; conclusion: string }>;
  historyFails?: boolean;
}) => {
  const created: Params[] = [];
  const comments: Params[] = [];
  const addedLabels: Params[] = [];
  const historyRequests: Params[] = [];
  const listRequests: Params[] = [];
  const warnings: string[] = [];

  const github = {
    rest: {
      actions: {
        listWorkflowRuns: (params: Params) => {
          historyRequests.push(params);
          if (options.historyFails) throw new Error("403 Resource not accessible");
          return Promise.resolve({ data: { workflow_runs: options.history ?? [] } });
        },
      },
      issues: {
        createLabel: () => Promise.resolve({}),
        listForRepo: (params: Params) => {
          listRequests.push(params);
          return Promise.resolve({ data: options.openItems ?? [] });
        },
        createComment: (params: Params) => {
          comments.push(params);
          return Promise.resolve({});
        },
        addLabels: (params: Params) => {
          addedLabels.push(params);
          return Promise.resolve({});
        },
        create: (params: Params) => {
          created.push(params);
          return Promise.resolve({ data: { number: 999 } });
        },
      },
    },
  };
  const context = { repo: { owner: "o", repo: "r" }, runId: 1, serverUrl: "https://github.com" };
  const core = { warning: (message: string) => warnings.push(message), notice: () => undefined };

  // new Function に流し込むのは、このリポジトリ自身の workflow ファイルから
  // 読んだ検査対象コードである (外部入力ではない)。github-script の埋め込み
  // scriptを実行する手段は他になく、実行しなければ分岐は検証できない。
  //
  // process はグローバルを触らず引数で差し替える。テスト間で実環境の
  // 環境変数が漏れると、順序依存で結果が変わる。
  const invoke = new Function(
    "github",
    "context",
    "core",
    "process",
    `return (async () => {\n${extractNotificationScript(smokeWorkflow)}\n})();`,
  ) as (g: unknown, c: unknown, co: unknown, p: unknown) => Promise<void>;

  await invoke(github, context, core, { env: { PROBE_OUTCOME: options.probeOutcome } });
  return { created, comments, addedLabels, historyRequests, listRequests, warnings };
};

describe("incident notification behaviour", () => {
  // ここは workflow の script を grep せず「実行」して確かめる。
  // 文字列照合は、到達しない分岐に書いてあるだけでも通ってしまうため、
  // 「検査経路が閉塞していても緑になる」という Issue #127 と同じ形を
  // テスト側に再現してしまう。

  it("notifies on probe failure and on the probe never running, but not on a post-probe glitch", () => {
    // if 条件はYAML側なので、ここだけは記述を読む。
    const condition = smokeWorkflow
      .slice(smokeWorkflow.indexOf("Report production smoke failure"))
      .match(/^\s*if:\s*(.+)$/m)?.[1];

    // outcome は step が走らなかった時に空文字になる。== 'failure' に絞ると
    // 「checkout が落ちて監視が一度も実行されなかった」run が無通知になり、
    // Issue #90 が防ごうとしている状態そのものを見逃す。
    expect(condition).toBe("failure() && steps.production-status.outcome != 'success'");
    expect(condition).not.toMatch(/outcome\s*==\s*'failure'/);
  });

  it("says the production state is unknown when the probe never ran", async () => {
    const failed = await runNotification({ probeOutcome: "failure" });
    const skipped = await runNotification({ probeOutcome: "" });

    // 本番が落ちたのか、監視が動かなかったのか。初動が違うので本文で区別する。
    expect(String(failed.created[0].title)).toContain("production smoke failure");
    expect(String(skipped.created[0].title)).toContain("did not reach the probe");
    expect(String(skipped.created[0].body)).toContain("判定できていません");
    expect(String(failed.created[0].body)).not.toContain("判定できていません");
  });

  it("counts the current run inside the advertised history depth, not on top of it", async () => {
    const { historyRequests, created } = await runNotification({
      probeOutcome: "failure",
      history: [
        { id: 2, conclusion: "failure" },
        { id: 3, conclusion: "failure" },
        { id: 4, conclusion: "success" },
      ],
    });

    // status:"completed" は実行中の現runを返さない。per_page を depth ちょうどに
    // すると実際の参照範囲が depth+1 になり、本文の「直近10run参照」が嘘になる。
    const depth = Number(smokeWorkflow.match(/const HISTORY_DEPTH = (\d+);/)?.[1]);
    expect(historyRequests[0].per_page).toBe(depth - 1);
    expect(String(created[0].body)).toContain(`3 (直近${depth}run参照)`);
    expect(String(created[0].title)).toContain("(3 consecutive)");
  });

  it("files the incident anyway when the history lookup is denied", async () => {
    const { created, warnings } = await runNotification({
      probeOutcome: "failure",
      historyFails: true,
    });

    // 補助情報の欠落で安全網を落とさない (fail-open)。ただし回数不明で P1 へ
    // 倒すと、当番が通知を信じなくなる。
    expect(created).toHaveLength(1);
    expect(String(created[0].labels)).toContain("P2");
    expect(warnings).toHaveLength(1);
  });

  it("does not let a same-labelled pull request swallow the incident", async () => {
    const { created, comments } = await runNotification({
      probeOutcome: "failure",
      openItems: [{ number: 700, pull_request: { url: "…" } }],
    });

    // issues.listForRepo は Pull Request も返す。除外しないと、そのPRへ
    // コメントして return し、incidentが起票されないまま通知が消える。
    expect(comments).toHaveLength(0);
    expect(created).toHaveLength(1);
  });

  it("appends to the open incident even when a pull request is listed ahead of it", async () => {
    const { created, comments, listRequests } = await runNotification({
      probeOutcome: "failure",
      openItems: [{ number: 700, pull_request: { url: "…" } }, { number: 42, labels: ["P2"] }],
      history: [{ id: 2, conclusion: "failure" }],
    });

    expect(created).toHaveLength(0);
    expect(comments[0].issue_number).toBe(42);
    // per_page:1 だと除外後に候補が残らず、既存incidentがあっても重複起票になる。
    expect(Number(listRequests[0].per_page)).toBeGreaterThan(1);
  });

  it("escalates an existing P2 incident once the failure repeats", async () => {
    const { addedLabels } = await runNotification({
      probeOutcome: "failure",
      openItems: [{ number: 42, labels: [{ name: "P2" }] }],
      history: [{ id: 2, conclusion: "failure" }],
    });

    expect(addedLabels[0]).toMatchObject({ issue_number: 42, labels: ["P1"] });
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
