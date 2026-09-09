import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * ローカル運用の健全性チェック（Issue #223）。
 *
 * 本番DBの日次バックアップが 2026-09-01 から 09-08 までの 7 日間停止していたが
 * 誰も気づかなかった（Issue #218）。`codip-backup.timer` は毎日発火し、毎回
 * 203/EXEC で失敗していた。**codip 系ユニットに失敗時の通知経路が一つも無く**、
 * 運用文書の「日次確認」は人間の手順であって機械的なゲートではなかった。
 *
 * ここでは検査スクリプトを**実際に走らせて**、当時と同じ状況を検出できることを
 * 確かめる。スクリプトの中身を文字列で照合するだけでは、判定が壊れても緑になる。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const script = path.join(repoRoot, "scripts/ops/check-local-ops-health.sh");
const workspaces: string[] = [];

function makeWorkspace(): { backups: string; markers: string } {
  const root = mkdtempSync(path.join(tmpdir(), "codip-ops-"));
  workspaces.push(root);
  const backups = path.join(root, "backups");
  const markers = path.join(root, "markers");
  mkdirSync(backups, { recursive: true });
  mkdirSync(markers, { recursive: true });
  return { backups, markers };
}

/** 検査を走らせ、終了コードと標準エラーを返す。 */
function runCheck(env: Record<string, string>): { code: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync("bash", [script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function writeBackup(dir: string, name: string, ageHours: number): void {
  const file = path.join(dir, name);
  writeFileSync(file, "dummy");
  const when = Date.now() / 1000 - ageHours * 3600;
  utimesSync(file, when, when);
}

afterAll(() => {
  for (const root of workspaces) rmSync(root, { recursive: true, force: true });
});

describe("check-local-ops-health.sh の挙動", () => {
  it("バックアップが新しくマーカーも無ければ正常終了する", () => {
    const ws = makeWorkspace();
    writeBackup(ws.backups, "codip-20260909T031700Z.dump.gpg", 2);

    const result = runCheck({
      CODIP_BACKUP_DIR: ws.backups,
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      // 実ホストのユニット状態に左右されないよう、存在しない接頭辞にする。
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("異常なし");
  });

  it("Issue #218 当時の状況（バックアップが7日前）を検出する", () => {
    // これが当時あれば、7 日間の空白は生じなかった。
    const ws = makeWorkspace();
    writeBackup(ws.backups, "codip-20260901T031702Z.dump.gpg", 24 * 7);

    const result = runCheck({
      CODIP_BACKUP_DIR: ws.backups,
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("バックアップが古い");
    expect(result.stderr).toContain("168時間前");
  });

  it("バックアップが1つも無い場合を検出する", () => {
    const ws = makeWorkspace();

    const result = runCheck({
      CODIP_BACKUP_DIR: ws.backups,
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("1 つも無い");
  });

  it("保存先ディレクトリ自体が無い場合を検出する", () => {
    const ws = makeWorkspace();

    const result = runCheck({
      CODIP_BACKUP_DIR: path.join(ws.backups, "does-not-exist"),
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("存在しない");
  });

  it("失敗マーカーが残っていれば、バックアップが新しくても検出する", () => {
    // failed 状態は次の成功で消える。oneshot の「失敗→成功」の繰り返しを
    // 状態だけで見ていると常に正常に見えるため、発生の痕跡を見る。
    const ws = makeWorkspace();
    writeBackup(ws.backups, "codip-20260909T031700Z.dump.gpg", 1);
    writeFileSync(
      path.join(ws.markers, "codip-backup.service"),
      "unit=codip-backup.service\nfailedAt=2026-09-02T18:17:00Z\n",
    );

    const result = runCheck({
      CODIP_BACKUP_DIR: ws.backups,
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("失敗マーカー");
    expect(result.stderr).toContain("codip-backup.service");
  });

  it("鮮度の上限を環境変数で調整できる", () => {
    const ws = makeWorkspace();
    writeBackup(ws.backups, "codip-recent.dump.gpg", 30);

    const strict = runCheck({
      CODIP_BACKUP_DIR: ws.backups,
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
      CODIP_MAX_BACKUP_AGE_HOURS: "26",
    });
    const lenient = runCheck({
      CODIP_BACKUP_DIR: ws.backups,
      CODIP_UNIT_FAILURE_DIR: ws.markers,
      CODIP_UNIT_PREFIX: "codip-nonexistent-",
      CODIP_MAX_BACKUP_AGE_HOURS: "48",
    });

    expect(strict.code).toBe(1);
    expect(lenient.code).toBe(0);
  });
});

describe("record-unit-failure.sh の契約", () => {
  const recorder = "scripts/ops/record-unit-failure.sh";
  const source = readFileSync(path.join(repoRoot, recorder), "utf8");

  it("git 管理下にあり実行可能である", () => {
    // Issue #218 は、実行主体が git の外に在ったために復元できなかった。
    execFileSync("git", ["ls-files", "--error-unmatch", recorder], { cwd: repoRoot });
    expect(statSync(path.join(repoRoot, recorder)).mode & 0o111).not.toBe(0);
  });

  it("ユニット名をそのままパスに使わない", () => {
    // OnFailure に渡る %n は systemd 由来だが、ファイル名として使う以上は絞る。
    expect(source).toContain("tr -c");
  });

  it("外部通知を行わない（宛先の選択は人間の判断のため）", () => {
    // コメント中の散文（「Webhook / Slack の追加は人間の判断」）を実装と
    // 取り違えないよう、# 始まりの行を落としてから見る。散文で緑にも赤にも
    // ならないようにする。
    const code = source
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");

    expect(code).not.toMatch(/\bcurl\b|\bwget\b|\bmail\b|\bsendmail\b/i);
  });
});
