import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_SECURE,
  adminSessionValue,
  adminSessionCookieName,
  createAdminSessionCookieValue,
  hasAdminSessionCookie,
  requireAdminRequest,
} from "@/lib/admin-auth";

function request(headers: HeadersInit = {}, method = "GET") {
  return new NextRequest("https://codip.example/api/tags", { headers, method });
}

describe("requireAdminRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects production admin requests when no guard is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "false");

    const response = requireAdminRequest(request());

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });

  it("accepts a matching admin token", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(request({ "x-codip-admin-token": "secret-token-12345678901234567890" }));

    expect(response).toBeNull();
  });

  it("accepts a signed HttpOnly session cookie value", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(
      request({ cookie: `${ADMIN_SESSION_COOKIE}=${adminSessionValue("secret-token-12345678901234567890")}` }),
    );

    expect(response).toBeNull();
  });

  it("accepts the secure __Host session cookie name", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(
      request({ cookie: `${ADMIN_SESSION_COOKIE_SECURE}=${adminSessionValue("secret-token-12345678901234567890")}` }),
    );

    expect(response).toBeNull();
  });

  it("uses __Host cookie names for secure requests and regular names for local HTTP", () => {
    vi.stubEnv("NODE_ENV", "production");
    const secureRequest = new NextRequest("https://codip.example/api/admin/session");
    const localRequest = new NextRequest("http://127.0.0.1:3100/api/admin/session");

    expect(adminSessionCookieName(secureRequest)).toBe(ADMIN_SESSION_COOKIE_SECURE);
    expect(adminSessionCookieName(localRequest)).toBe(ADMIN_SESSION_COOKIE_SECURE);

    vi.stubEnv("CODIP_ALLOW_INSECURE_LOCAL_COOKIES", "true");
    expect(adminSessionCookieName(localRequest)).toBe(ADMIN_SESSION_COOKIE);
  });

  it("ignores forwarded proto for cookie security unless proxy headers are explicitly trusted", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODIP_ALLOW_INSECURE_LOCAL_COOKIES", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_HEADERS", "false");
    const forwardedRequest = new NextRequest("http://127.0.0.1:3100/api/admin/session", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(adminSessionCookieName(forwardedRequest)).toBe(ADMIN_SESSION_COOKIE);

    vi.stubEnv("CODIP_TRUST_PROXY_HEADERS", "true");
    expect(adminSessionCookieName(forwardedRequest)).toBe(ADMIN_SESSION_COOKIE_SECURE);
  });

  it("detects either admin session cookie name", () => {
    const secureCookieRequest = new NextRequest("https://codip.example/api/admin/session", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE_SECURE}=value` },
    });
    const localCookieRequest = new NextRequest("http://127.0.0.1:3100/api/admin/session", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=value` },
    });

    expect(hasAdminSessionCookie(secureCookieRequest)).toBe(true);
    expect(hasAdminSessionCookie(localCookieRequest)).toBe(true);
  });

  it("accepts a signed session cookie for unsafe methods from the same origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(
      request(
        {
          cookie: `${ADMIN_SESSION_COOKIE}=${adminSessionValue("secret-token-12345678901234567890")}`,
          origin: "https://codip.example",
        },
        "POST",
      ),
    );

    expect(response).toBeNull();
  });

  it("rejects cross-origin unsafe requests that rely on the session cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(
      request(
        {
          cookie: `${ADMIN_SESSION_COOKIE}=${adminSessionValue("secret-token-12345678901234567890")}`,
          origin: "https://evil.example",
        },
        "DELETE",
      ),
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: "csrf_check_failed",
    });
  });

  it("does not let untrusted forwarded host satisfy same-origin checks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");
    vi.stubEnv("CODIP_TRUST_PROXY_HEADERS", "false");

    const response = requireAdminRequest(
      request(
        {
          cookie: `${ADMIN_SESSION_COOKIE}=${adminSessionValue("secret-token-12345678901234567890")}`,
          origin: "https://trusted.example",
          host: "codip.example",
          "x-forwarded-host": "trusted.example",
          "x-forwarded-proto": "https",
        },
        "POST",
      ),
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: "csrf_check_failed",
    });
  });

  it("allows forwarded host in same-origin checks only when proxy headers are trusted", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");
    vi.stubEnv("CODIP_TRUST_PROXY_HEADERS", "true");

    const response = requireAdminRequest(
      request(
        {
          cookie: `${ADMIN_SESSION_COOKIE}=${adminSessionValue("secret-token-12345678901234567890")}`,
          origin: "https://trusted.example",
          host: "internal.example",
          "x-forwarded-host": "trusted.example",
          "x-forwarded-proto": "https",
        },
        "POST",
      ),
    );

    expect(response).toBeNull();
  });

  it("does not apply browser CSRF checks to explicit admin token headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(
      request(
        { "x-codip-admin-token": "secret-token-12345678901234567890", origin: "https://evil.example" },
        "DELETE",
      ),
    );

    expect(response).toBeNull();
  });

  it("rejects expired signed session cookie values", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");
    const cookie = createAdminSessionCookieValue("secret-token-12345678901234567890", 0, "nonce-value-with-enough-length");

    const response = requireAdminRequest(request({ cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` }));

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("rejects an invalid admin session cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = requireAdminRequest(request({ cookie: `${ADMIN_SESSION_COOKIE}=invalid` }));

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("requires explicit opt-in before allowing insecure local admin access", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "false");
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "false");

    const response = requireAdminRequest(request());

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });

  it("allows insecure admin access only when local development explicitly opts in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "true");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");

    const response = requireAdminRequest(request());

    expect(response).toBeNull();
  });

  it("does not trust proxy identity headers without the shared proxy secret", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "");

    const response = requireAdminRequest(
      request({ "cf-access-authenticated-user-email": "admin@example.com" }),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });

  it("does not trust proxy identity headers without an admin email allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "proxy-secret-12345678901234567890");
    vi.stubEnv("CODIP_ADMIN_EMAILS", "");

    const response = requireAdminRequest(
      request({
        "cf-access-authenticated-user-email": "admin@example.com",
        "x-codip-proxy-secret": "proxy-secret-12345678901234567890",
      }),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });

  it("rejects trusted proxy identities outside the admin email allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "proxy-secret-12345678901234567890");
    vi.stubEnv("CODIP_ADMIN_EMAILS", "admin@example.com");

    const response = requireAdminRequest(
      request({
        "cf-access-authenticated-user-email": "user@example.com",
        "x-codip-proxy-secret": "proxy-secret-12345678901234567890",
      }),
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: "unauthorized",
    });
  });

  it("accepts trusted proxy identity only when the shared proxy secret and allowlist match", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "proxy-secret-12345678901234567890");
    vi.stubEnv("CODIP_ADMIN_EMAILS", "admin@example.com");

    const response = requireAdminRequest(
      request({
        "cf-access-authenticated-user-email": "admin@example.com",
        "x-codip-proxy-secret": "proxy-secret-12345678901234567890",
      }),
    );

    expect(response).toBeNull();
  });

  it("rejects cross-origin unsafe requests that rely on trusted proxy identity", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "proxy-secret-12345678901234567890");
    vi.stubEnv("CODIP_ADMIN_EMAILS", "admin@example.com");

    const response = requireAdminRequest(
      request(
        {
          "cf-access-authenticated-user-email": "admin@example.com",
          "x-codip-proxy-secret": "proxy-secret-12345678901234567890",
          origin: "https://evil.example",
        },
        "POST",
      ),
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: "csrf_check_failed",
    });
  });

  it("rejects short production admin tokens at runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "short-token");

    const response = requireAdminRequest(request({ "x-codip-admin-token": "short-token" }));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });

  it("rejects short preview admin tokens even outside NODE_ENV production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODIP_ENV_MODE", "preview");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "short-token");

    const response = requireAdminRequest(request({ "x-codip-admin-token": "short-token" }));

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });

  it("does not allow insecure admin opt-in in preview mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CODIP_ENV_MODE", "preview");
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "true");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "");

    const response = requireAdminRequest(request());

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: "admin_guard_not_configured",
    });
  });
});
