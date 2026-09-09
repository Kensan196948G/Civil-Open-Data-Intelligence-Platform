import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 対話要素のアクセシビリティ契約（Deep Debug 対応 6/6）。
 *
 * ■ 何を防ぐか
 *
 * 1. `<a>` の中に `<button>` を入れない
 *    HTML 仕様違反（対話要素の入れ子）で、スクリーンリーダーとキーボードでの
 *    役割・フォーカス順序が曖昧になる。TerrainWorkspace のレポート出力が
 *    これで、しかも無効時の `pointer-events-none` はマウスしか止めないため、
 *    `<a>` は Tab でフォーカスでき Enter で `#` へ遷移してしまい、
 *    無効化の意図をすり抜けていた（`aria-disabled` は伝達だけで遷移を止めない）。
 *
 * 2. 取り消せない破壊的操作に確認を挟む
 *    `DeleteSourceButton` は `window.confirm` を挟んでいたのに、閾値削除と
 *    ロール失効は挟んでいなかった。**同じ危険度の操作で作法が割れている**状態は、
 *    どちらが正しいのか読み手に判断させることになる。
 *
 * ■ コメントを落としてから見る
 *
 * この種の検査は、実装ではなく**説明文**に反応しやすい。実際このテストを書く
 * 過程で、`// 以前は <a> の中に <button> を入れていた` という自分のコメントに
 * 検出器が反応した（同じ失敗を local-ops-health のテストでも踏んでいる）。
 * 散文で緑にも赤にもならないよう、コメントを除去してから判定する。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** JSX/TS のコメント（行・ブロック）を落とす。文字列内の "//" は稀なので許容する。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

function collectTsx(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectTsx(full));
    else if (entry.endsWith(".tsx")) found.push(full);
  }
  return found;
}

describe("対話要素を入れ子にしない", () => {
  it("<a> が <button> を包んでいる箇所が無い", () => {
    const offenders: string[] = [];

    for (const file of collectTsx(path.join(repoRoot, "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
        if (/<button\b/.test(match[1])) {
          const line = code.slice(0, match.index).split("\n").length;
          offenders.push(`${path.relative(repoRoot, file)}:${line}`);
        }
      }
    }

    expect(
      offenders,
      `<a> の中に <button> があります（対話要素の入れ子）:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("検出器がコメント内の記述に反応しない", () => {
    // このテスト自身が「説明文で赤になる」壊れ方をしないことを固定する。
    const withOnlyComment = `
      // 以前は <a> の中に <button> を入れていた
      /* <a><button/></a> のような書き方はしない */
      const x = 1;
    `;
    const code = stripComments(withOnlyComment);

    expect(code).not.toContain("<button");
    expect(code).toContain("const x = 1;");
  });
});

describe("取り消せない破壊的操作は確認を挟む", () => {
  const destructive = [
    {
      file: "src/components/DeleteSourceButton.tsx",
      what: "データソース削除（関連する取得ログ・サンプルも消える）",
    },
    {
      file: "src/components/RoleManagementPanel.tsx",
      what: "ロール失効（アクセス権が即座に失われる）",
    },
    {
      file: "src/components/weather/WeatherWorkspace.tsx",
      what: "閾値削除（施工可否判定の基準から外れる）",
    },
  ];

  for (const { file, what } of destructive) {
    it(`${what} に window.confirm がある`, () => {
      const code = stripComments(readFileSync(path.join(repoRoot, file), "utf8"));
      expect(code, `${file} に確認ダイアログがありません`).toContain("window.confirm");
    });
  }
});

describe("アイコンのみのボタンにアクセシブルネームがある", () => {
  it("絵文字だけの button に aria-label が付いている", () => {
    // 絵文字のみのアクセシブルネームはスクリーンリーダーの読み上げが環境依存。
    const offenders: string[] = [];
    // 開始タグに aria-label を持たず、中身が絵文字と空白だけの button を探す。
    const buttonPattern = /<button\b([^>]*)>\s*([^<]{0,8}?)\s*<\/button>/g;
    const emojiOnly = /^[\p{Extended_Pictographic}️‍\s]+$/u;

    for (const file of collectTsx(path.join(repoRoot, "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(buttonPattern)) {
        const [, attrs, body] = match;
        if (body === "" || !emojiOnly.test(body)) continue;
        if (/aria-label/.test(attrs)) continue;
        const line = code.slice(0, match.index).split("\n").length;
        offenders.push(`${path.relative(repoRoot, file)}:${line} (${body.trim()})`);
      }
    }

    expect(
      offenders,
      `絵文字のみで aria-label の無い button があります:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
