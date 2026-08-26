import { describe, expect, test } from "vitest";
import {
  ACCESS_USER_EMAIL_HEADER,
  PROXY_SECRET_HEADER,
  STRIPPED_REQUEST_HEADERS,
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

  // 以前は「既存の proxy secret があれば null を返す」実装で、これを fail-safe と
  // 称していた。実際には外部が用意したヘッダーをそのままオリジンへ到達させる
  // 素通し経路であり、シークレットが漏れた場合に Access を迂回できた。
  // 正しい境界処理は「まず除去し、その後で必要なら注入する」。
  test("外部から届いた proxy secret は素通しせず、正規の値で上書きする", () => {
    const headers = new Headers({
      [ACCESS_USER_EMAIL_HEADER]: "kensan1969@gmail.com",
      [PROXY_SECRET_HEADER]: "attacker-supplied-value",
    });
    const result = buildInjectedHeaders(ENABLED_ENV, headers);
    expect(result).not.toBeNull();
    expect(result?.get(PROXY_SECRET_HEADER)).toBe(ENABLED_ENV.CODIP_TRUST_PROXY_SECRET);
  });

  test("Access識別ヘッダーが無ければ、届いた proxy secret を除去して注入もしない", () => {
    const headers = new Headers({ [PROXY_SECRET_HEADER]: "attacker-supplied-value" });
    const result = buildInjectedHeaders(ENABLED_ENV, headers);
    expect(result).not.toBeNull();
    expect(result?.has(PROXY_SECRET_HEADER)).toBe(false);
  });

  test("注入が無効な設定でも、届いた内部ヘッダーは除去する", () => {
    const headers = new Headers({
      [ACCESS_USER_EMAIL_HEADER]: "kensan1969@gmail.com",
      [PROXY_SECRET_HEADER]: "attacker-supplied-value",
      "x-codip-user": "admin@example.com",
    });
    const result = buildInjectedHeaders({}, headers);
    expect(result).not.toBeNull();
    expect(result?.has(PROXY_SECRET_HEADER)).toBe(false);
    expect(result?.has("x-codip-user")).toBe(false);
    // 素性の確かな Access 識別ヘッダーは残す
    expect(result?.get(ACCESS_USER_EMAIL_HEADER)).toBe("kensan1969@gmail.com");
  });

  test("caller が付けた x-codip-user はオリジンへ渡さない", () => {
    const headers = new Headers({
      [ACCESS_USER_EMAIL_HEADER]: "viewer@example.com",
      "x-codip-user": "admin@example.com",
    });
    const result = buildInjectedHeaders(ENABLED_ENV, headers);
    expect(result?.has("x-codip-user")).toBe(false);
    expect(result?.get(ACCESS_USER_EMAIL_HEADER)).toBe("viewer@example.com");
  });

  test("除去対象ヘッダーの一覧が縮んでいないこと", () => {
    expect([...STRIPPED_REQUEST_HEADERS]).toEqual([PROXY_SECRET_HEADER, "x-codip-user"]);
  });

  test("設定無効かつ除去対象が無ければ書き換えない", () => {
    const headers = new Headers({ [ACCESS_USER_EMAIL_HEADER]: "kensan1969@gmail.com" });
    expect(buildInjectedHeaders({}, headers)).toBeNull();
  });
});
