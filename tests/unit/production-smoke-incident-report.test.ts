import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * production-smoke.yml の incident 起票ロジックに対する挙動テスト (Issue #207 RCA)。
 *
 * ■ なぜ workflow の文字列一致ではなく実行するのか
 *
 * 障害時に当番が最初に読むのは Issue のタイトルと「連続失敗回数」である。ここが
 * 誤ると初動の判断そのものが誤る。実際 Issue #207 では、約60時間・240run 継続した
 * 障害が次のように記録されていた。
 *
 *   タイトル : [P2] production smoke failure (1 consecutive)   ← 起票時のまま凍結
 *   本文     : 連続失敗回数 | 11 (直近10run参照)                ← 窓で飽和した下限値
 *
 * どちらも「そう読めてしまう」ことが欠陥であり、workflow に特定の文字列が在るか
 * ではなく、与えた run 履歴に対して何を出力するかでしか検証できない。よって inline
 * script を抽出して実際に実行し、出力を突き合わせる。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflowSource = readFileSync(
  path.join(repoRoot, ".github/workflows/production-smoke.yml"),
  "utf8",
);

/**
 * `script: |` ブロックを抽出して dedent する。YAML パーサを新規依存として
 * 持ち込まずに済むよう、ブロックスカラーのインデント規則だけを使う。
 */
function extractInlineScript(source: string): string {
  const lines = source.split("\n");
  const startIndex = lines.findIndex((line) => /^\s*script:\s*\|\s*$/.test(line));
  expect(startIndex, "production-smoke.yml に `script: |` ブロックが見つからない").toBeGreaterThan(-1);

  const markerIndent = lines[startIndex].match(/^\s*/)![0].length;
  const body: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    const indent = line.match(/^\s*/)![0].length;
    if (indent <= markerIndent) break;
    body.push(line);
  }

  const blockIndent = Math.min(
    ...body.filter((line) => line !== "").map((line) => line.match(/^\s*/)![0].length),
  );
  return body.map((line) => line.slice(blockIndent)).join("\n");
}

const inlineScript = extractInlineScript(workflowSource);

type Call = { name: string; args: Record<string, unknown> };

interface RunIncidentOptions {
  /** listWorkflowRuns が返す run 履歴 (現 run を含まない、新しい順)。 */
  previousRuns: Array<{ id: number; conclusion: string }>;
  /** 既に open な incident。null なら新規起票経路。 */
  openIncident?: { number: number; title: string; labels: Array<{ name: string }> } | null;
  probeOutcome?: string;
  notificationTestInput?: boolean;
  /** listWorkflowRuns を失敗させ、履歴取得不能時の挙動を見る。 */
  historyThrows?: boolean;
}

async function runIncidentScript(options: RunIncidentOptions) {
  const {
    previousRuns,
    openIncident = null,
    probeOutcome = "failure",
    notificationTestInput = false,
    historyThrows = false,
  } = options;

  const calls: Call[] = [];
  const record = (name: string) => async (args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "issues.create") return { data: { number: 999 } };
    return { data: {} };
  };

  const currentRunId = 5_000_000;

  const github = {
    rest: {
      actions: {
        listWorkflowRuns: async (args: Record<string, unknown>) => {
          calls.push({ name: "actions.listWorkflowRuns", args });
          if (historyThrows) throw new Error("history unavailable");
          return { data: { workflow_runs: previousRuns } };
        },
      },
      issues: {
        createLabel: record("issues.createLabel"),
        listForRepo: async (args: Record<string, unknown>) => {
          calls.push({ name: "issues.listForRepo", args });
          return { data: openIncident ? [openIncident] : [] };
        },
        createComment: record("issues.createComment"),
        addLabels: record("issues.addLabels"),
        update: record("issues.update"),
        create: record("issues.create"),
      },
    },
  };

  const context = {
    repo: { owner: "Kensan196948G", repo: "Civil-Open-Data-Intelligence-Platform" },
    runId: currentRunId,
    serverUrl: "https://github.com",
    payload: { inputs: { run_notification_test: String(notificationTestInput) } },
  };

  const notices: string[] = [];
  const warnings: string[] = [];
  const core = {
    notice: (message: string) => notices.push(message),
    warning: (message: string) => warnings.push(message),
  };

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction("github", "context", "core", "process", inlineScript);
  await fn(github, context, core, { env: { PROBE_OUTCOME: probeOutcome } });

  const find = (name: string) => calls.find((call) => call.name === name);
  return {
    calls,
    notices,
    warnings,
    createdIssue: find("issues.create")?.args as { title?: string; body?: string } | undefined,
    comment: find("issues.createComment")?.args as { body?: string } | undefined,
    titleUpdate: find("issues.update")?.args as { title?: string } | undefined,
    addedLabels: find("issues.addLabels")?.args as { labels?: string[] } | undefined,
  };
}

const failures = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: 1_000 + index, conclusion: "failure" }));

describe("production smoke incident report / 連続失敗回数の飽和", () => {
  it("観測窓が全て失敗のときは下限値であることを『以上』で表記する", async () => {
    // 窓 (HISTORY_DEPTH) を使い切っても非失敗runに当たらない = 実際の連続失敗は不明で、
    // 得られるのは下限だけ。ここを確定値として書くと障害の長さを過小に伝える。
    const result = await runIncidentScript({ previousRuns: failures(100) });

    expect(result.createdIssue?.title).toContain("101以上 consecutive");
    expect(result.createdIssue?.body).toContain("101以上");
    expect(result.createdIssue?.body).toContain("実際の連続失敗はこれ以上");
    // 「101 (直近100run参照)」のような確定値表記へ退行していないこと。
    expect(result.createdIssue?.body).not.toMatch(/\|\s*101\s*\(/);
  });

  it("窓の内側で非失敗runに当たったときは確定値として『以上』を付けない", async () => {
    const result = await runIncidentScript({
      previousRuns: [...failures(2), { id: 42, conclusion: "success" }, ...failures(5)],
    });

    expect(result.createdIssue?.title).toContain("3 consecutive");
    expect(result.createdIssue?.title).not.toContain("以上");
    expect(result.createdIssue?.body).toContain("3 (直近100run参照)");
    // 本文には「連続2回以上の失敗のため P1」という別文が常に載るため、
    // 「以上」の有無は連続失敗回数のセルに限定して見る。
    expect(result.createdIssue?.body).not.toMatch(/連続失敗回数 \| \d+以上/);
  });

  it("窓の最後のrunが非失敗でも飽和と誤判定しない", async () => {
    // 打ち切り位置が窓端と重なるケース。件数だけで飽和を導くと取り違える。
    const result = await runIncidentScript({
      previousRuns: [...failures(3), { id: 77, conclusion: "success" }],
    });

    expect(result.createdIssue?.title).toContain("4 consecutive");
    expect(result.createdIssue?.title).not.toContain("以上");
  });

  it("観測窓の上限は listWorkflowRuns の per_page 上限 (100) を使う", async () => {
    const result = await runIncidentScript({ previousRuns: failures(100) });
    const historyCall = result.calls.find((call) => call.name === "actions.listWorkflowRuns");

    expect(historyCall?.args.per_page).toBe(100);
  });

  it("run履歴を取得できないときは回数を不明として P2 に留める", async () => {
    const result = await runIncidentScript({ previousRuns: [], historyThrows: true });

    expect(result.createdIssue?.title).toContain("[P2]");
    expect(result.createdIssue?.body).toContain("不明 (run履歴取得に失敗)");
    expect(result.warnings.join("\n")).toContain("history unavailable");
  });
});

describe("production smoke incident report / タイトルの追随", () => {
  it("継続中incidentのタイトルを最新の重大度と連続失敗回数へ更新する", async () => {
    // Issue #207 の実害: 60時間経過後もタイトルが起票時のまま
    // "[P2] production smoke failure (1 consecutive)" で、一覧上は初回失敗に見えた。
    const result = await runIncidentScript({
      previousRuns: failures(100),
      openIncident: {
        number: 207,
        title: "[P2] production smoke failure (1 consecutive)",
        labels: [{ name: "incident" }, { name: "P2" }, { name: "production-smoke" }],
      },
    });

    expect(result.titleUpdate?.title).toBe("[P1] production smoke failure (101以上 consecutive)");
    expect(result.addedLabels?.labels).toEqual(["P1"]);
    expect(result.comment?.body).toContain("101以上");
    // 追記経路では新規Issueを作らない (15分毎に増殖させない)。
    expect(result.createdIssue).toBeUndefined();
  });

  it("タイトルが既に最新なら更新APIを呼ばない", async () => {
    const result = await runIncidentScript({
      previousRuns: failures(100),
      openIncident: {
        number: 207,
        title: "[P1] production smoke failure (101以上 consecutive)",
        labels: [{ name: "incident" }, { name: "P1" }, { name: "production-smoke" }],
      },
    });

    expect(result.titleUpdate).toBeUndefined();
    expect(result.addedLabels).toBeUndefined();
  });

  it("通知受信テストは実障害のタイトル表記へ混ざらない", async () => {
    const result = await runIncidentScript({
      previousRuns: failures(100),
      probeOutcome: "success",
      notificationTestInput: true,
    });

    expect(result.createdIssue?.title).toBe("[TEST] [P2] production smoke failure (1 consecutive)");
    expect(result.calls.some((call) => call.name === "actions.listWorkflowRuns")).toBe(false);
  });
});
