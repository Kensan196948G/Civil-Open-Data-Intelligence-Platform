import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE_SECURE,
  adminSessionValue,
} from "@/lib/admin-auth";
import {
  DELETE as sessionDELETE,
  GET as sessionGET,
  POST as sessionPOST,
} from "@/app/api/admin/session/route";
import { resetRateLimitForTests } from "@/lib/rate-limit";

function request(init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest("https://codip.example/api/admin/session", {
    ...init,
    headers: {
      origin: "https://codip.example",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function localRequest(init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest("http://127.0.0.1:3100/api/admin/session", init);
}

describe("admin session route", () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimitForTests();
  });

  it("creates a signed __Host HttpOnly session cookie for a matching admin token over HTTPS", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = await sessionPOST(
      request({
        method: "POST",
        body: JSON.stringify({ token: "secret-token-12345678901234567890" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(ADMIN_SESSION_COOKIE_SECURE);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).not.toContain("secret-token-12345678901234567890");
  });

  it("creates a browser-usable local HTTP session cookie without Secure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");
    vi.stubEnv("CODIP_ALLOW_INSECURE_LOCAL_COOKIES", "true");

    const response = await sessionPOST(
      localRequest({
        method: "POST",
        body: JSON.stringify({ token: "secret-token-12345678901234567890" }),
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3100",
        },
      }),
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(response.status).toBe(200);
    expect(setCookie).toContain(ADMIN_SESSION_COOKIE);
    expect(setCookie).not.toContain(ADMIN_SESSION_COOKIE_SECURE);
    expect(setCookie).not.toContain("Secure");
  });

  it("rejects a wrong token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = await sessionPOST(
      request({
        method: "POST",
        body: JSON.stringify({ token: "wrong-token" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rate limits repeated session start attempts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        sessionPOST(
          request({
            method: "POST",
            body: JSON.stringify({ token: "wrong-token" }),
            headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
          }),
        ),
      ),
    );

    expect(attempts.at(-1)?.status).toBe(429);
  });

  it("rejects cross-origin browser session starts", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = await sessionPOST(
      request({
        method: "POST",
        body: JSON.stringify({ token: "secret-token-12345678901234567890" }),
        headers: { "content-type": "application/json", origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "csrf_check_failed" });
  });

  it("rejects browser session starts without Origin or Referer", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = await sessionPOST(
      new NextRequest("https://codip.example/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ token: "secret-token-12345678901234567890" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "csrf_check_failed" });
  });

  it("reports authenticated when a valid session cookie is present", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", "secret-token-12345678901234567890");

    const response = await sessionGET(
      request({
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${adminSessionValue("secret-token-12345678901234567890")}` },
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({ authenticated: true, sessionCookie: true });
  });

  it("clears the session cookie", async () => {
    const response = await sessionDELETE(request({ method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain(`${ADMIN_SESSION_COOKIE_SECURE}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects cross-origin browser session deletion", async () => {
    const response = await sessionDELETE(
      request({ method: "DELETE", headers: { origin: "https://evil.example" } }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "csrf_check_failed" });
  });
});
