import { describe, expect, it } from "vitest";
import {
  hasSecretQueryParams,
  hasUrlCredentials,
  sanitizeUrl,
  secretQueryParamNames,
} from "@/lib/url-safety";

describe("hasUrlCredentials", () => {
  it("ユーザー名・パスワード付きURLを検出する", () => {
    expect(hasUrlCredentials("https://user:pass@example.com/data.json")).toBe(true);
  });

  it("資格情報を含まないURLはfalseを返す", () => {
    expect(hasUrlCredentials("https://example.com/data.json")).toBe(false);
  });

  it("解析不能な入力は安全側(true)に倒す", () => {
    expect(hasUrlCredentials("not-a-url")).toBe(true);
    expect(hasUrlCredentials("")).toBe(true);
  });
});

describe("secretQueryParamNames", () => {
  it("秘密情報らしきクエリ名を列挙する", () => {
    expect(secretQueryParamNames("https://example.com/data?token=abc&foo=bar")).toEqual([
      "token",
    ]);
  });

  it("該当なしなら空配列を返す", () => {
    expect(secretQueryParamNames("https://example.com/data?foo=bar")).toEqual([]);
  });

  it("解析不能な入力は空配列を返す(列挙契約を維持)", () => {
    expect(secretQueryParamNames("not-a-url")).toEqual([]);
  });
});

describe("hasSecretQueryParams", () => {
  it("秘密情報らしきクエリがあればtrueを返す", () => {
    expect(hasSecretQueryParams("https://example.com/data?api_key=abc")).toBe(true);
  });

  it("秘密情報らしきクエリがなければfalseを返す", () => {
    expect(hasSecretQueryParams("https://example.com/data?foo=bar")).toBe(false);
  });

  it("解析不能な入力は安全側(true)に倒す", () => {
    expect(hasSecretQueryParams("not-a-url")).toBe(true);
    expect(hasSecretQueryParams("")).toBe(true);
  });
});

describe("sanitizeUrl", () => {
  it("ユーザー名・パスワードを除去する", () => {
    expect(sanitizeUrl("https://user:pass@example.com/data.json")).toBe(
      "https://example.com/data.json",
    );
  });

  it("秘密情報らしきクエリ値をマスクする", () => {
    expect(sanitizeUrl("https://example.com/data?token=abc123&foo=bar")).toBe(
      "https://example.com/data?token=***&foo=bar",
    );
  });

  it("解析不能な入力は元の文字列を漏らさず固定表現を返す", () => {
    expect(sanitizeUrl("not-a-url")).toBe("[invalid-url]");
    expect(sanitizeUrl("https://user:s3cr3t@internal.example/leak?token=abc")).not.toContain(
      "s3cr3t",
    );
  });
});
