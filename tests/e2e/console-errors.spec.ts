import { expect, test } from "@playwright/test";
import { CSP_CONTRACT_ROUTES } from "./csp-contract";
import { type CapturedEntry, describeEntries, unexplainedEntries } from "./console-noise";

/**
 * console error / 未捕捉例外の検知 (Issue #125 / T-Q4)。
 *
 * CSP 違反はヘッダが正しくてもブラウザ側でしか現れない。nonce 事故のように
 * 「ヘッダは妥当だが実際には全スクリプトがブロックされている」状態は、ヘッダの
 * 契約テストでは検知できず、console error として初めて観測できる。
 *
 * 既存 spec を全面改修せず新規 spec として足しているのは、既存 spec の目的
 * (画面の振る舞い) と、この spec の目的 (ページが静かに壊れていないこと) が
 * 別であり、混ぜると失敗時の原因切り分けが難しくなるため。
 */
test.describe("console error / 未捕捉例外", () => {
  for (const route of CSP_CONTRACT_ROUTES) {
    test(`${route.path} (${route.rendering}) が説明不能な console error を出さない`, async ({ page }) => {
      const captured: CapturedEntry[] = [];

      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const location = message.location();
        captured.push({
          source: "console",
          route: route.path,
          text: message.text(),
          location: location.url ? `${location.url}:${location.lineNumber}` : "",
        });
      });

      page.on("pageerror", (error) => {
        captured.push({
          source: "pageerror",
          route: route.path,
          text: `${error.name}: ${error.message}`,
          location: "",
        });
      });

      await page.goto(route.path);
      // hydration まで到達させる。ここを待たないと、クライアント側で起きる
      // CSP 違反や未捕捉例外を取りこぼす
      await page.waitForLoadState("load");
      await expect(page.locator("#main-content")).toBeVisible();

      const unexplained = unexplainedEntries(captured);
      expect(describeEntries(unexplained), `${route.path} で説明できない console error / 例外`).toBe("");
    });
  }
});
