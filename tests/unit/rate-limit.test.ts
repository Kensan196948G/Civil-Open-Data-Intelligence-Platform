import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, clientIdentifier, resetRateLimitForTests } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows requests up to the configured limit", () => {
    expect(checkRateLimit("api", "user", 2, 1000, 0)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(checkRateLimit("api", "user", 2, 1000, 100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(checkRateLimit("api", "user", 2, 1000, 200)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it("resets after the window expires", () => {
    checkRateLimit("api", "user", 1, 1000, 0);
    expect(checkRateLimit("api", "user", 1, 1000, 500).allowed).toBe(false);
    expect(checkRateLimit("api", "user", 1, 1000, 1000)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("separates buckets by name and identity", () => {
    checkRateLimit("api-a", "user", 1, 1000, 0);
    expect(checkRateLimit("api-b", "user", 1, 1000, 0).allowed).toBe(true);
    expect(checkRateLimit("api-a", "other-user", 1, 1000, 0).allowed).toBe(true);
  });

  it("ignores spoofable forwarded IP headers unless proxy headers are trusted", () => {
    const request = new NextRequest("https://codip.example/api/admin/session", {
      headers: {
        "cf-connecting-ip": "203.0.113.1",
        "x-forwarded-for": "203.0.113.2",
        "x-codip-client-id": "attacker-controlled",
      },
    });

    expect(clientIdentifier(request)).toBe("local");

    vi.stubEnv("CODIP_TRUST_PROXY_HEADERS", "true");
    expect(clientIdentifier(request)).toBe("203.0.113.1");
  });
});
