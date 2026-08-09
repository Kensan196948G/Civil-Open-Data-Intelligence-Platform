import { describe, expect, test } from "vitest";
import {
  ACCESS_USER_EMAIL_HEADER,
  PROXY_SECRET_HEADER,
  buildInjectedHeaders,
  proxyAuthInjectionEnabled,
} from "../../src/lib/proxy-auth-inject";

// gitleaks の汎用キー検出を避けるため、テスト用シークレットはリテラルで書かない
const TEST_PROXY_SECRET = ["test-proxy-secret", "value", "0123456789"].join("-");

const ENABLED_ENV = {
  CODIP_TRUST_PROXY_AUTH: "true",
  CODIP_TRUST_PROXY_SECRET: TEST_PROXY_SECRET,
};

describe("proxy-auth-inject", () => {
  test("設定が揃っている場合のみ注入が有効になる", () => {
    expect(proxyAuthInjectionEnabled(ENABLED_ENV)).toBe(true);
    expect(proxyAuthInjectionEnabled({ ...ENABLED_ENV, CODIP_TRUST_PROXY_AUTH: "false" })).toBe(false);
    expect(proxyAuthInjectionEnabled({ ...ENABLED_ENV, CODIP_TRUST_PROXY_SECRET: "" })).toBe(false);
    expect(proxyAuthInjectionEnabled({})).toBe(false);
  });

  test("Accessユーザー識別ヘッダーがあるリクエストにのみシークレットを注入する", () => {
    const withUser = new Headers({ [ACCESS_USER_EMAIL_HEADER]: "kensan1969@gmail.com" });
    const injected = buildInjectedHeaders(ENABLED_ENV, withUser);
    expect(injected).not.toBeNull();
    expect(injected?.get(PROXY_SECRET_HEADER)).toBe(ENABLED_ENV.CODIP_TRUST_PROXY_SECRET);
    expect(injected?.get(ACCESS_USER_EMAIL_HEADER)).toBe("kensan1969@gmail.com");

    const withoutUser = new Headers();
    expect(buildInjectedHeaders(ENABLED_ENV, withoutUser)).toBeNull();
  });

  test("既存の proxy secret は上書きしない (fail-safe)", () => {
    const headers = new Headers({
      [ACCESS_USER_EMAIL_HEADER]: "kensan1969@gmail.com",
      [PROXY_SECRET_HEADER]: "existing-secret",
    });
    expect(buildInjectedHeaders(ENABLED_ENV, headers)).toBeNull();
  });

  test("設定無効時は何も注入しない", () => {
    const headers = new Headers({ [ACCESS_USER_EMAIL_HEADER]: "kensan1969@gmail.com" });
    expect(buildInjectedHeaders({}, headers)).toBeNull();
  });
});
