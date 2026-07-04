import { describe, expect, it } from "vitest";
import { isPrivateIp, validateUrl } from "@/lib/url-guard";

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
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:192.168.0.1",
  ])("非公開IP %s を検出する", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "203.0.113.10", "2001:4860:4860::8888"])(
    "公開IP %s は許可する",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
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
    "http://server.local/",
    "http://intra.internal/",
  ])("SSRF対象 %s を拒否する", (url) => {
    expect(validateUrl(url).ok).toBe(false);
  });
});
