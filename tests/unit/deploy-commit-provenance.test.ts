import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 実体の spawnSync を残すと、結線が壊れた場合に本物の git / gh / wrangler が走る。
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

import { main } from "../../scripts/deploy/deploy-production.mjs";

/**
 * デプロイ対象 commit の素性ゲート。
 *
 * このゲートが無いあいだ、deploy-production.mjs は **ローカル作業ツリーの内容を
 * そのまま本番へ出していた**（383行のうち git 検証は0行）。未コミット・未 push・
 * 未マージ・CI 未通過のコードが本番へ到達しうる状態であり、
 * 「main の確定 commit と検証済み commit の一致を確認し、その固定 commit から
 * デプロイする」という運用条件を機械的に担保できていなかった。
 *
 * ここで測るのは「関数が正しいか」ではなく **「main() が実際に呼んでいるか」** と
 * 「停止したとき遠隔状態へ触れていないか」である。前者を測らないテストは、
 * 呼び出し行が外れても緑のまま通る。
 */

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

type GitResponses = {
  head?: string;
  porcelain?: string;
  originMain?: string;
  lsRemote?: string;
  checkRuns?: { status: number; stdout?: string; stderr?: string };
};

function wireGit({ head = HEAD, porcelain = "", originMain = HEAD, lsRemote, checkRuns }: GitResponses = {}) {
  const remote = lsRemote ?? `${originMain}\trefs/heads/main`;
  spawnSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command === "git") {
      const sub = args[0];
      if (sub === "rev-parse") {
        return { status: 0, stdout: args[1] === "HEAD" ? `${head}\n` : `${originMain}\n`, stderr: "" };
      }
      if (sub === "status") return { status: 0, stdout: porcelain ? `${porcelain}\n` : "", stderr: "" };
      if (sub === "fetch") return { status: 0, stdout: "", stderr: "" };
      if (sub === "ls-remote") return { status: 0, stdout: `${remote}\n`, stderr: "" };
    }
    if (command === "gh") {
      return checkRuns ?? { status: 0, stdout: "verify=success\ne2e=success\n", stderr: "" };
    }
    // ここへ到達したら、ゲートを抜けて後段の子プロセスが起きている。
    throw new Error(`unexpected child process after the provenance gate: ${command} ${args.join(" ")}`);
  });
}

/** ゲート通過後に必ず要求される環境変数。ここまで来たこと自体が「通過」の証拠になる。 */
const PAST_GATE = /NEON_API_KEY|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/;

beforeEach(() => {
  spawnSyncMock.mockReset();
  process.argv = ["node", "deploy-production.mjs", "--skip-deploy"];
  for (const k of ["NEON_API_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) delete process.env[k];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deploy 対象 commit の素性ゲート", () => {
  it("作業ツリーが汚れていれば停止し、遠隔状態へ触れない", async () => {
    wireGit({ porcelain: " M src/app/page.tsx\n?? secret-notes.txt" });
    await expect(main()).rejects.toThrow(/working tree is not clean/);
    // porcelain の固定長 slice はパス先頭を削る。ファイル名がそのまま出ること。
    await expect(main()).rejects.toThrow(/src\/app\/page\.tsx/);
    expect(spawnSyncMock).not.toHaveBeenCalledWith("gh", expect.anything(), expect.anything());
  });

  it("HEAD が origin/main と一致しなければ停止する（未マージ commit を出さない）", async () => {
    wireGit({ head: HEAD, originMain: OTHER });
    await expect(main()).rejects.toThrow(/does not match origin\/main/);
  });

  it("ローカルの origin/main が古い（リモート実体と不一致）場合は停止する", async () => {
    wireGit({ head: HEAD, originMain: HEAD, lsRemote: `${OTHER}\trefs/heads/main` });
    await expect(main()).rejects.toThrow(/remote main .* does not match HEAD/);
  });

  it("CI 結果を取得できなければ「成功」とみなさず停止する", async () => {
    wireGit({ checkRuns: { status: 1, stdout: "", stderr: "gh: not authenticated" } });
    await expect(main()).rejects.toThrow(/could not read CI results/);
  });

  it("CI の check-run が1件も無ければ停止する（未検証 commit を出さない）", async () => {
    wireGit({ checkRuns: { status: 0, stdout: "", stderr: "" } });
    await expect(main()).rejects.toThrow(/no CI check-runs found/);
  });

  it("CI が緑でなければ停止する", async () => {
    wireGit({ checkRuns: { status: 0, stdout: "verify=success\ne2e=failure\n", stderr: "" } });
    await expect(main()).rejects.toThrow(/CI is not green/);
  });

  it("skipped / neutral は成功として扱う（GitHub の必須チェックと同じ扱い）", async () => {
    wireGit({ checkRuns: { status: 0, stdout: "verify=success\ndocker-supply-chain=skipped\nx=neutral\n", stderr: "" } });
    // ゲートを通過し、後段が必須環境変数を要求して落ちる = 通過の証拠
    await expect(main()).rejects.toThrow(PAST_GATE);
  });

  it("clean・origin/main 一致・CI 緑なら通過する", async () => {
    wireGit();
    await expect(main()).rejects.toThrow(PAST_GATE);
  });

  it("--allow-dirty-deploy は git 検査だけを外し、CI 検査は残す", async () => {
    process.argv.push("--allow-dirty-deploy");
    wireGit({
      porcelain: " M src/app/page.tsx",
      originMain: OTHER,
      checkRuns: { status: 0, stdout: "verify=failure\n", stderr: "" },
    });
    // git 側では止まらず、CI 側で止まる
    await expect(main()).rejects.toThrow(/CI is not green/);
  });
});
