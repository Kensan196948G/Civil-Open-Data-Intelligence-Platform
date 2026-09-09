import { expect, test } from "@playwright/test";

/**
 * 共有URL (`/terrain#...`) を開いたときに hydration が壊れないことの回帰テスト。
 *
 * ■ 何が起きていたか
 *
 * `TerrainWorkspace` は `dynamic(ssr:false)` ではなく server component
 * (`src/app/terrain/page.tsx`) から直接読まれるため SSR される。にもかかわらず
 * 初期 state を render 中の `window.location.hash` から作っていた。
 *
 * サーバへは hash が送られないので、SSR は常に `DEFAULT_VIEW_STATE` を描画する
 * (2026-09-09 実測: 本番SSRの `<select aria-label="ベースレイヤー">` は hash に
 * 関わらず常に `value="std" selected=""` を返していた)。一方クライアントの初回
 * 描画は hash の値になる。つまり **共有URLを開いた瞬間だけ** hydration mismatch が
 * 起きる。このコンポーネントの目玉機能である共有URLを使ったときにだけ壊れる、
 * という最悪の壊れ方だった。
 *
 * 修正後は hash の復元をマウント後の effect で行う。したがって本テストは
 *   1. hydration エラーが出ないこと
 *   2. それでも共有された状態が最終的に反映されること
 * の両方を見る。1 だけだと「復元をやめれば緑」になってしまい、機能を殺す修正を
 * 通してしまう。
 */

const SHARED_HASH = "view=12/35.36072/138.72726&base=pale&tab=section";

test.describe("共有URLの復元と hydration", () => {
  test("共有URLを開いても hydration エラーが出ず、共有された状態が反映される", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      errors.push(`${error.name}: ${error.message}`);
    });

    await page.goto(`/terrain#${SHARED_HASH}`);
    // hydration まで到達させる。ここを待たないとクライアント側の不一致を取りこぼす。
    await page.waitForLoadState("load");
    await expect(page.locator("#main-content")).toBeVisible();

    // 1. hydration mismatch を検出する。React は不一致時に console error を出す。
    const hydrationErrors = errors.filter((text) =>
      /hydrat|did not match|server rendered HTML/i.test(text),
    );
    expect(
      hydrationErrors,
      `hydration エラーが出ています:\n${hydrationErrors.join("\n")}`,
    ).toEqual([]);

    // 2. 共有された状態が反映されている (復元を捨てる修正では緑にならない)。
    await expect(page.getByLabel("ベースレイヤー")).toHaveValue("pale", { timeout: 10_000 });
  });

  test("hash 無しで開いた場合は既定値のままで、hash を既定値で潰さない", async ({ page }) => {
    await page.goto("/terrain");
    await page.waitForLoadState("load");
    await expect(page.locator("#main-content")).toBeVisible();

    await expect(page.getByLabel("ベースレイヤー")).toHaveValue("std");
  });

  test("復元前の書き戻しで共有 hash を失わない", async ({ page }) => {
    // 復元 effect より先に「hash への書き戻し」effect が既定値で走ると、共有URLの
    // 状態が読み込み直後に消える。マウント後も hash が保持されていることを見る。
    await page.goto(`/terrain#${SHARED_HASH}`);
    await page.waitForLoadState("load");
    await expect(page.getByLabel("ベースレイヤー")).toHaveValue("pale", { timeout: 10_000 });

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain("base=pale");
  });
});
