import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ローカル本番リリース手順の契約（Issue #231）。
 *
 * 本番は 2026-09-09 まで開発の作業ディレクトリから `next start` していた。
 * 稼働中に `.next` が作り直されると配信中の HTML が参照する chunk が消え、
 * 実際に JS が 400 を返す状態になった。開発者が `npm run build` を叩くだけで
 * 本番が壊れる構成だったが、**それを検知する仕組みが一つも無かった**。
 *
 * ここで固定するのは「壊れない構成であること」ではなく（それは systemd 側の
 * 設定で、リポジトリからは検査できない）、**リリース手順が備えるべき性質**である。
 * 手順が静かに劣化すると、隔離の意味が失われるため。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const scriptPath = "scripts/deploy/deploy-local-production.sh";
const scriptSource = readFileSync(path.join(repoRoot, scriptPath), "utf8");

const isGitTracked = (relativePath: string): boolean => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relativePath], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

describe("deploy-local-production.sh の契約", () => {
  it("git 管理下にあり実行可能である", () => {
    // 旧バックアップスクリプトは git 管理外に置かれ、消えたときに復元できなかった
    // (Issue #218)。同じ轍を踏まない。
    expect(isGitTracked(scriptPath)).toBe(true);
    expect(statSync(path.join(repoRoot, scriptPath)).mode & 0o111).not.toBe(0);
  });

  it("secret をハードコードしていない", () => {
    expect(scriptSource).not.toMatch(/postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/);
  });

  it("開発の作業ディレクトリではなくリリースディレクトリを配信対象にする", () => {
    // current シンボリックリンクを介すのが隔離の本体。
    expect(scriptSource).toContain("CURRENT_LINK");
    expect(scriptSource).toMatch(/releases/);
  });

  it("作りかけのリリースを current にしない", () => {
    // clone / npm ci / build の途中経過が current から見えると、その間の
    // アクセスが壊れる。完成させてから移す。
    expect(scriptSource).toMatch(/staging/);
    expect(scriptSource).toMatch(/mv -T "\$staging" "\$target"/);
  });

  it("current の張り替えを原子的に行う", () => {
    // ln -sf は一度リンクを消してから作るため、その隙間に起動すると失敗する。
    expect(scriptSource).toMatch(/mv -T "\$CURRENT_LINK\.tmp" "\$CURRENT_LINK"/);
  });

  it("直前のリリースを previous として保持し、ロールバックできる", () => {
    expect(scriptSource).toContain("PREVIOUS_LINK");
    expect(scriptSource).toMatch(/--rollback/);
  });

  it("再起動後にヘルスチェックが通らなければ自動で切り戻す", () => {
    // 「デプロイした」と「動いている」は別。通らないまま成功と記録しない。
    expect(scriptSource).toContain("wait_healthy");
    expect(scriptSource).toMatch(/切り戻/);
  });

  it("整理処理が current と previous を消さない", () => {
    expect(scriptSource).toContain("keep_current");
    expect(scriptSource).toContain("keep_previous");
  });

  it("配備したリリース識別子を EnvironmentFile へ書き出す", () => {
    // どの commit を配信しているかを外形から確認できるようにする。
    expect(scriptSource).toContain("CODIP_RELEASE_SHA");
    expect(scriptSource).toContain("RELEASE_ENV_FILE");
  });
});

describe("/api/health のリリース申告", () => {
  const healthSource = readFileSync(
    path.join(repoRoot, "src/app/api/health/route.ts"),
    "utf8",
  );

  it("配信中のリリース識別子を返す", () => {
    expect(healthSource).toContain("CODIP_RELEASE_SHA");
    expect(healthSource).toContain("release");
  });

  it("未設定を空文字ではなく unknown として返す", () => {
    // 空文字だと「未設定」と「開発環境」が区別できず、監視側が判断できない。
    expect(healthSource).toContain('"unknown"');
  });
});

describe("runbook と実装の対応", () => {
  const runbook = readFileSync(
    path.join(repoRoot, "docs/runbooks/local-production-release.md"),
    "utf8",
  );

  it("runbook が実在するスクリプトを指している", () => {
    expect(runbook).toContain(scriptPath);
  });

  it("systemd の初回導入が人間の作業であることを明記している", () => {
    // 本番実行構成の変更は自動実行の対象外。手順書側にもその線引きを残す。
    expect(runbook).toMatch(/人間が実施/);
  });

  it("credential を unit へ直書きしない方針を記している", () => {
    expect(runbook).toContain("EnvironmentFile");
    expect(runbook).toMatch(/systemctl cat/);
  });
});
