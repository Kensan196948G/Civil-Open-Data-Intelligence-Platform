import { describe, expect, it } from "vitest";
import { checkUrlSafety } from "@/lib/terrain/adapters";

// UT-SEC-01: SSRF URL safety gate (detailed design spec ch.14).
describe("checkUrlSafety", () => {
  const options = {
    allowedHosts: ["cyberjapandata.gsi.go.jp", "optimal-solution.gsi.go.jp"],
  } as const;

  it("allows an allowlisted host over https", () => {
    const result = checkUrlSafety(
      new URL("https://cyberjapandata.gsi.go.jp/xyz/dem/14/14550/6451.txt"),
      options,
    );
    expect(result.allowed).toBe(true);
  });

  it("rejects a non-https protocol", () => {
    const result = checkUrlSafety(
      new URL("http://cyberjapandata.gsi.go.jp/xyz/dem/14/14550/6451.txt"),
      options,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("protocol");
  });

  it("rejects a host outside the allowlist", () => {
    const result = checkUrlSafety(new URL("https://evil.example.com/steal"), options);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("allowlist");
  });

  it("rejects a loopback IPv4 literal", () => {
    const result = checkUrlSafety(new URL("https://127.0.0.1/xyz/dem/14/1/1.txt"), options);
    expect(result.allowed).toBe(false);
  });

  it("rejects private IPv4 ranges", () => {
    for (const host of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      const result = checkUrlSafety(new URL(`https://${host}/x`), options);
      expect(result.allowed, host).toBe(false);
    }
  });

  it("rejects the link-local cloud metadata address (169.254.169.254)", () => {
    const result = checkUrlSafety(new URL("https://169.254.169.254/latest/meta-data/"), options);
    expect(result.allowed).toBe(false);
  });

  it("rejects an IP literal even if it is present in the allowlist (defense in depth)", () => {
    const result = checkUrlSafety(new URL("https://127.0.0.1/x"), {
      allowedHosts: ["127.0.0.1"],
    });
    expect(result.allowed).toBe(false);
  });

  it("rejects a public IP literal that is not in the allowlist", () => {
    const result = checkUrlSafety(new URL("https://8.8.8.8/x"), options);
    expect(result.allowed).toBe(false);
  });

  it("rejects IPv6 loopback, link-local and unique-local literals", () => {
    for (const host of ["[::1]", "[fe80::1]", "[fc00::1]", "[fd00::1]"]) {
      const result = checkUrlSafety(new URL(`https://${host}/x`), options);
      expect(result.allowed, host).toBe(false);
    }
  });

  it("rejects an IPv4-mapped IPv6 loopback literal", () => {
    const result = checkUrlSafety(new URL("https://[::ffff:127.0.0.1]/x"), options);
    expect(result.allowed).toBe(false);
  });

  it("matches allowlist hosts case-insensitively", () => {
    const result = checkUrlSafety(
      new URL("https://CyberJapanData.GSI.go.jp/xyz/dem/14/1/1.txt"),
      options,
    );
    expect(result.allowed).toBe(true);
  });
});
