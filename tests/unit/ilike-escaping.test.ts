import { describe, expect, it } from "vitest";
import { escapeLikePattern } from "@/lib/standard-records";

/**
 * ILIKE の検索語をリテラルとして扱うことの回帰テスト。
 *
 * 値はパラメータ化されているので SQL インジェクションは成立しない。問題は
 * `%` と `_` が **パターンのメタ文字として解釈される**ことで、検索語 `%%` が
 * 「全行に一致するパターン」になり `q` の下限2文字ガードを自明に回避できた。
 * `properties::text ILIKE` は索引が無く全行スキャンになるため可用性の問題になる。
 */
describe("escapeLikePattern", () => {
  it("ワイルドカード % をリテラル化する（下限2文字ガードの自明な回避を塞ぐ）", () => {
    expect(escapeLikePattern("%%")).toBe("\\%\\%");
    expect(escapeLikePattern("a%b")).toBe("a\\%b");
  });

  it("単一文字ワイルドカード _ をリテラル化する", () => {
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("___")).toBe("\\_\\_\\_");
  });

  it("エスケープ文字そのもの（バックスラッシュ）を先に退避する", () => {
    // `\%` を入力されたとき、`\` を退避しないと「エスケープされた %」に化ける
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
    expect(escapeLikePattern("\\")).toBe("\\\\");
  });

  it("通常の検索語は変更しない（日本語・記号を含む）", () => {
    expect(escapeLikePattern("避難所")).toBe("避難所");
    expect(escapeLikePattern("国道1号")).toBe("国道1号");
    expect(escapeLikePattern("A-B.C")).toBe("A-B.C");
    expect(escapeLikePattern("")).toBe("");
  });

  it("メタ文字だけの入力でもリテラル化され、全件一致にならない", () => {
    const escaped = escapeLikePattern("%_%");
    expect(escaped).toBe("\\%\\_\\%");
    // 素の % が1つも残っていないこと（残っていればパターンとして効いてしまう）
    expect(escaped.replace(/\\./g, "")).not.toContain("%");
    expect(escaped.replace(/\\./g, "")).not.toContain("_");
  });
});
