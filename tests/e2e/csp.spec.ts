import { expect, test } from "@playwright/test";
import {
  CSP_CONTRACT_ROUTES,
  CSP_HEADER,
  E2E_SCRIPT_SRC_VARIANT,
  describeCspProblems,
  evaluateCspHeaders,
  scriptSrcVariantOf,
} from "./csp-contract";

/**
 * CSP ヘッダの契約テスト (Issue #125 / T-Q4)。
 *
 * docs/design/csp-script-src-decision.md §5 が記録しているとおり、この検査が
 * 入るまで CI は「CSP を変更しても静的ページが白画面化する類の回帰」を自動検出
 * できなかった。同 §7 の解除条件 4 がこのテストの存在理由である。
 */
test.describe("CSP ヘッダ契約", () => {
  for (const route of CSP_CONTRACT_ROUTES) {
    test(`${route.path} (${route.rendering}) が固定した CSP 構成を返す`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response, `${route.path} のレスポンスを取得できなかった`).not.toBeNull();

      const headers = response!.headers();
      // 受容構成を development へ固定する。固定しないと `'unsafe-eval'` の有無が
      // 常に「環境差」として説明され、本番相当の緩和を見逃す
      const problems = evaluateCspHeaders(headers, { scriptSrcVariant: E2E_SCRIPT_SRC_VARIANT });

      // 空文字列との比較にすることで、失敗時に違反内容がそのまま diff に出る
      expect(describeCspProblems(problems), `${route.path} の CSP 構成が契約と異なる`).toBe("");

      // 実際に観測した構成を証跡として残す (production 構成は本番デプロイでしか
      // 観測できないため、この spec は production 側を検証していない)
      const variant = scriptSrcVariantOf(headers[CSP_HEADER] ?? "");
      test.info().annotations.push({ type: "csp-script-src-variant", description: `${route.path}: ${variant}` });
    });
  }

  test("静的ルートと動的ルートで同一の CSP を返す", async ({ page }) => {
    // ルート単位で異なるポリシーを配る構成 (裁定で却下された案C' = 動的ルートだけ
    // nonce 化) は、同一オリジンである以上弱い側のルートからオリジン全体が侵害
    // されるため採らない。ここが分岐したら構成変更が入ったということ
    const observed = new Map<string, string>();
    for (const route of CSP_CONTRACT_ROUTES) {
      const response = await page.goto(route.path);
      expect(response, `${route.path} のレスポンスを取得できなかった`).not.toBeNull();
      observed.set(route.path, response!.headers()[CSP_HEADER] ?? "");
    }

    const values = [...new Set(observed.values())];
    expect(
      values.length,
      `ルートによって CSP が異なる:\n${[...observed].map(([path, value]) => `${path}: ${value}`).join("\n")}`,
    ).toBe(1);
  });
});
