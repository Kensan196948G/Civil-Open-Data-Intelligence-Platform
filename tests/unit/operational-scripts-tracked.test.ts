import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 運用文書が指すスクリプトが git 管理下に在ることの契約テスト (Issue #218 再発防止)。
 *
 * ■ なぜ必要か
 *
 * 本番の日次バックアップは `scripts/local-cron/run-backup.sh` が担っていたが、この
 * ディレクトリは `.gitignore` の対象だった。接続文字列を内包していたため意図的に
 * 除外されていたのだが、その結果として次が同時に成立してしまった。
 *
 *   - runbook・operations-ledger は「このスクリプトが日次で動く」と書いている
 *   - 実体は git の外にあり、消えても git では復元できない
 *   - 消えた後も systemd タイマーは毎日発火し、203/EXEC で失敗し続ける
 *
 * 2026-09-01 に実体が消失し、2026-09-08 に発見されるまで 7 日間バックアップが
 * 存在しなかった。文書上は ✅ のままだった。
 *
 * 「文書が指す運用スクリプトは git で復元できる」ことを機械的に固定する。secret は
 * スクリプトではなく実行環境 (systemd の EnvironmentFile 等) 側に置く。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** docs 配下の Markdown を再帰的に集める。 */
function collectMarkdown(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectMarkdown(full));
    } else if (entry.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

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

/** docs 内で参照されている scripts/ 配下のパスを、参照元ファイルつきで集める。 */
function collectReferencedScripts(): Map<string, string[]> {
  const references = new Map<string, string[]>();
  const pattern = /scripts\/[A-Za-z0-9_./-]+\.(?:sh|js|mjs|ts)/g;

  for (const markdownPath of collectMarkdown(path.join(repoRoot, "docs"))) {
    const relativeSource = path.relative(repoRoot, markdownPath);
    for (const line of readFileSync(markdownPath, "utf8").split("\n")) {
      // 「旧」「削除」「廃止」と明記された履歴記述は、現行の運用対象ではない。
      if (/旧|削除|廃止|移行前/.test(line)) continue;
      for (const match of line.match(pattern) ?? []) {
        const sources = references.get(match) ?? [];
        if (!sources.includes(relativeSource)) sources.push(relativeSource);
        references.set(match, sources);
      }
    }
  }
  return references;
}

describe("運用文書が指すスクリプトは git で復元できる", () => {
  const referenced = collectReferencedScripts();

  it("docs から参照される scripts/ のパスを検出できている", () => {
    // 検出そのものが壊れると、以降の assertion が空集合に対して常に緑になる。
    expect(referenced.size).toBeGreaterThan(10);
  });

  it("参照されている全スクリプトが実在する", () => {
    const missing = [...referenced.entries()]
      .filter(([scriptPath]) => !existsSync(path.join(repoRoot, scriptPath)))
      .map(([scriptPath, sources]) => `${scriptPath} (参照元: ${sources.join(", ")})`);

    expect(missing, `運用文書が実在しないスクリプトを指しています:\n${missing.join("\n")}`).toEqual(
      [],
    );
  });

  it("参照されている全スクリプトが git 管理下にある", () => {
    // git の外にあるスクリプトは、消えたときに復元できない。文書が「動いている」と
    // 書いている運用資産を、復元不能な場所へ置かない (Issue #218)。
    const untracked = [...referenced.entries()]
      .filter(([scriptPath]) => !isGitTracked(scriptPath))
      .map(([scriptPath, sources]) => `${scriptPath} (参照元: ${sources.join(", ")})`);

    expect(
      untracked,
      `運用文書が git 管理外のスクリプトを指しています:\n${untracked.join("\n")}`,
    ).toEqual([]);
  });
});

describe("バックアップスクリプトの契約", () => {
  const backupScriptPath = "scripts/db/pg-backup.sh";
  const source = readFileSync(path.join(repoRoot, backupScriptPath), "utf8");

  it("git 管理下にあり実行可能である", () => {
    expect(isGitTracked(backupScriptPath)).toBe(true);
    const mode = statSync(path.join(repoRoot, backupScriptPath)).mode;
    expect(mode & 0o111, "実行ビットが立っていないと systemd から 203/EXEC で失敗する").not.toBe(
      0,
    );
  });

  it("credential をハードコードしていない", () => {
    // secret を内包すると .gitignore へ追い出す動機が生まれ、Issue #218 を再発させる。
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/);
    expect(source).toContain("DATABASE_URL");
  });

  it("サーバのメジャーバージョンに一致する pg_dump / pg_restore を選ぶ", () => {
    // PATH 上の pg_dump(17) / pg_restore(16) / psql(18) が食い違っていたため、
    // 取得はできるがサーバに合う pg_restore では開けないダンプが生成されていた。
    expect(source).toContain("server_version_num");
    expect(source).toContain("/usr/lib/postgresql/${server_major}/bin");
  });

  it("取得したダンプを pg_restore --list で検証してから成功とする", () => {
    // 「取得できた」は「復元できる」の証拠ではない。検証を伴わない成功記録を作らない。
    expect(source).toContain("--list");
    expect(source).toMatch(/検証に失敗しました/);
  });
});
