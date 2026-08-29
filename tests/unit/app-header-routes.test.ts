import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * ヘッダのタイトル定義とサイドバーのルートを一致させる契約テスト。
 *
 * `AppHeader` の `metaFor()` は該当する `VIEW_META` が無いと
 * **`VIEW_META[0]`（ダッシュボード）へ落ちる**。そのため定義が抜けても
 * 画面は壊れず、ただ「別画面のタイトルが出る」だけになる。
 * 実際に6ルート（/terrain /weather /sites /decisions /reports /watchlist）が
 * 抜けており、いずれも「🏠 ダッシュボード」と表示されていた。
 *
 * 画面を増やしたときに気づけるよう、2つの一覧の対応を固定する。
 */

const header = readFileSync("src/components/AppHeader.tsx", "utf8");
const sidebar = readFileSync("src/components/AppSidebar.tsx", "utf8");

/** AppSidebar の href（動的セグメントを持たないトップレベルのみ）。 */
function sidebarRoutes(): string[] {
  return [...sidebar.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
}

/** AppHeader の VIEW_META prefix。 */
function headerPrefixes(): string[] {
  return [...header.matchAll(/prefix:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
}

describe("AppHeader の VIEW_META と AppSidebar のルート", () => {
  it("対照: 両方の一覧が実際に読めている", () => {
    // これが落ちるなら、下のテストは「一致した」ではなく「何も見ていない」を意味する。
    expect(sidebarRoutes().length).toBeGreaterThan(5);
    expect(headerPrefixes().length).toBeGreaterThan(5);
  });

  it("サイドバーの全ルートにヘッダ定義がある（無いと別画面のタイトルが出る）", () => {
    const prefixes = new Set(headerPrefixes());
    const missing = sidebarRoutes().filter((r) => !prefixes.has(r));
    expect(missing, `VIEW_META に定義が無いルート: ${missing.join(", ")}`).toEqual([]);
  });

  it("フォールバックが VIEW_META[0] のままであること（この仕様に依存している）", () => {
    // 実装が変わったらこのテストの前提が崩れるので、明示的に固定する。
    expect(header).toMatch(/return hit \?\? VIEW_META\[0\]/);
  });

  it("プレフィックスの前後関係が壊れていない（/sources/new が /sources より前）", () => {
    const order = headerPrefixes();
    expect(order.indexOf("/sources/new")).toBeLessThan(order.indexOf("/sources"));
  });
});
