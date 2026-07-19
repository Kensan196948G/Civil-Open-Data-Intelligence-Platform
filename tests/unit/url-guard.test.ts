import { beforeEach, describe, expect, it, vi } from "vitest";

const resolve4Mock = vi.hoisted(() => vi.fn());
const resolve6Mock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: resolve4Mock,
    resolve6: resolve6Mock,
  },
  resolve4: resolve4Mock,
  resolve6: resolve6Mock,
}));

import { assertSafeUrl, isPrivateIp, validateUrl } from "@/lib/url-guard";

beforeEach(() => {
  resolve4Mock.mockReset();
  resolve6Mock.mockReset();
});

describe("assertSafeUrl", () => {
  it("resolve4/resolve6 の公開IP解決結果を許可する", async () => {
    resolve4Mock.mockResolvedValue(["8.8.8.8"]);
    resolve6Mock.mockRejectedValue(Object.assign(new Error("no ipv6"), { code: "ENODATA" }));

    await expect(assertSafeUrl("https://example.com/data.json")).resolves.toMatchObject({
      ok: true,
    });
  });

  it("DNS解決結果がprivate IPを含む場合は拒否する", async () => {
    resolve4Mock.mockResolvedValue(["192.168.0.10"]);
    resolve6Mock.mockResolvedValue(["2001:4860:4860::8888"]);

    await expect(assertSafeUrl("https://example.com/data.json")).resolves.toMatchObject({
      ok: false,
      reason: "内部ネットワークへ解決されるホストは禁止されています",
    });
  });

  it("A/AAAA の両方が解決できない場合はfail-closedする", async () => {
    resolve4Mock.mockRejectedValue(Object.assign(new Error("no a"), { code: "ENODATA" }));
    resolve6Mock.mockRejectedValue(Object.assign(new Error("no aaaa"), { code: "ENODATA" }));

    await expect(assertSafeUrl("https://example.com/data.json")).resolves.toMatchObject({
      ok: false,
      reason: "ホスト名を解決できませんでした",
    });
  });
});

describe("isPrivateIp", () => {
  it.each([
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:192.168.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::ffff:0a00:0001",
    "0:0:0:0:0:ffff:127.0.0.1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::10.0.0.1",
  ])("非公開IP %s を検出する", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.0.1",
    "172.32.0.1",
    "203.0.113.10",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "::ffff:808:808",
  ])("公開IP %s は許可する", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("validateUrl", () => {
  it("https の公開URLを許可する", () => {
    const result = validateUrl("https://www.gsi.go.jp/");
    expect(result.ok).toBe(true);
  });

  it("http の公開URLを許可する", () => {
    expect(validateUrl("http://example.com/data.json").ok).toBe(true);
  });

  it.each([
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("http/https 以外のスキーム %s を拒否する", (url) => {
    expect(validateUrl(url).ok).toBe(false);
  });

  it("URL形式でない文字列を拒否する", () => {
    expect(validateUrl("not a url").ok).toBe(false);
  });

  it.each([
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://10.0.0.5/api",
    "http://192.168.10.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[64:ff9b::7f00:1]/",
    "http://server.local/",
    "http://intra.internal/",
  ])("SSRF対象 %s を拒否する", (url) => {
    expect(validateUrl(url).ok).toBe(false);
  });
});
