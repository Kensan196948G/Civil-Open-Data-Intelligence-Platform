import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createRoleResolver,
  invalidateRoleCache,
  normalizeEmail,
  requireRole,
  userEmailFromRequest,
  DEFAULT_ROLE,
} from "../../src/lib/rbac";

type Row = {
  scope: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  role: { name: string; priority: number };
};

const row = (role: string, scope = "global", opts: Partial<Row> = {}): Row => ({
  scope,
  expiresAt: null,
  revokedAt: null,
  role: { name: role, priority: 0 },
  ...opts,
});

function fakeCache() {
  const store = new Map<string, { role: string; expiresAt: number }>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: { role: string; expiresAt: number }) => {
      store.set(k, v);
    },
    delete: (k: string) => store.delete(k),
  };
}

describe("createRoleResolver", () => {
  it("falls back to viewer when no assignment exists", async () => {
    const resolver = createRoleResolver({ findMany: vi.fn().mockResolvedValue([]) as never });
    await expect(resolver("USER@EXAMPLE.COM")).resolves.toBe(DEFAULT_ROLE);
  });

  it("picks the highest-priority role among global assignments", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row("engineer"),
      row("data-steward"),
      row("viewer"),
    ]);
    const resolver = createRoleResolver({ findMany: findMany as never, cache: fakeCache() });
    await expect(resolver("user@example.com")).resolves.toBe("data-steward");
  });

  it("prefers a scoped assignment over a global one", async () => {
    const findMany = vi.fn().mockResolvedValue([
      row("admin", "global"),
      row("engineer", "site:site-1"),
    ]);
    const resolver = createRoleResolver({ findMany: findMany as never, cache: fakeCache() });
    await expect(resolver("user@example.com", "site:site-1")).resolves.toBe("engineer");
  });

  it("ignores expired and revoked assignments", async () => {
    const now = new Date("2026-08-12T00:00:00Z");
    const findMany = vi.fn().mockResolvedValue([
      row("admin", "global", { expiresAt: new Date("2026-08-11T00:00:00Z") }),
      row("admin", "global", { revokedAt: new Date("2026-08-10T00:00:00Z") }),
      row("engineer", "global"),
    ]);
    const resolver = createRoleResolver({ findMany: findMany as never, cache: fakeCache() });
    await expect(resolver("user@example.com", "global", now)).resolves.toBe("engineer");
  });

  it("caches per scope+email and normalizes the email", async () => {
    const findMany = vi.fn().mockResolvedValue([row("engineer")]);
    const cache = fakeCache();
    const resolver = createRoleResolver({ findMany: findMany as never, cache });
    await resolver("User@Example.com");
    await resolver("user@example.com");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where.userEmail).toBe("user@example.com");
  });

  it("re-validates after the cached assignment expires", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([row("admin", "global", { expiresAt: new Date("2026-08-12T00:00:30Z") })])
      .mockResolvedValueOnce([row("engineer", "global")]);
    const resolver = createRoleResolver({ findMany: findMany as never, cache: fakeCache() });

    // 期限（30秒後）の直前に解決 → admin
    await expect(resolver("user@example.com", "global", new Date("2026-08-12T00:00:20Z"))).resolves.toBe(
      "admin",
    );
    // 期限後（60秒時点）に解決 → キャッシュが失効し再問い合わせ → engineer
    await expect(resolver("user@example.com", "global", new Date("2026-08-12T00:01:00Z"))).resolves.toBe(
      "engineer",
    );
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache so a revocation takes effect immediately", async () => {
    const email = `revoke-${Date.now()}@example.com`;
    const findMany = vi.fn().mockResolvedValue([row("admin", "global")]);
    // モジュール既定キャッシュを使う（invalidateRoleCache は既定キャッシュを消す）
    const resolver = createRoleResolver({ findMany: findMany as never });

    await resolver(email);
    invalidateRoleCache(email);
    await resolver(email);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("fails closed to viewer when the database read throws", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("db down"));
    const resolver = createRoleResolver({ findMany: findMany as never, cache: fakeCache() });
    await expect(resolver("user@example.com")).resolves.toBe(DEFAULT_ROLE);
  });
});

describe("request helpers", () => {
  it("normalizes emails", () => {
    expect(normalizeEmail(" User@Example.COM ")).toBe("user@example.com");
  });

  it("reads the injected user header with fallback only when the proxy identity is trusted", () => {
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "unit-test-proxy-secret-1234567890");

    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: {
        "x-codip-user": "Field@Example.com",
        "x-codip-proxy-secret": "unit-test-proxy-secret-1234567890",
      },
    });
    expect(userEmailFromRequest(req)).toBe("field@example.com");

    const fallback = new NextRequest("http://localhost/api/v1/sites", {
      headers: {
        "cf-access-authenticated-user-email": "Back@Example.com",
        "x-codip-proxy-secret": "unit-test-proxy-secret-1234567890",
      },
    });
    expect(userEmailFromRequest(fallback)).toBe("back@example.com");

    const none = new NextRequest("http://localhost/api/v1/sites");
    expect(userEmailFromRequest(none)).toBeNull();

    // 偽装ヘッダーだけでは信頼しない（proxy secret不一致）
    const spoofed = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "engineer@example.com" },
    });
    expect(userEmailFromRequest(spoofed)).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("requireRole / requireRoleOrAdmin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 without a user identity", async () => {
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "unit-test-proxy-secret-1234567890");
    const req = new NextRequest("http://localhost/api/v1/sites");
    const response = await requireRole(req, ["engineer"], async () => "viewer");
    expect(response?.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("returns 403 when the role is not allowed", async () => {
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "unit-test-proxy-secret-1234567890");
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: {
        "x-codip-user": "viewer@example.com",
        "x-codip-proxy-secret": "unit-test-proxy-secret-1234567890",
      },
    });
    const response = await requireRole(req, ["engineer"], async () => "viewer");
    expect(response?.status).toBe(403);
    const body = await response?.json();
    expect(body.error.code).toBe("forbidden");
    vi.unstubAllEnvs();
  });

  it("allows an allowed role", async () => {
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "unit-test-proxy-secret-1234567890");
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: {
        "x-codip-user": "engineer@example.com",
        "x-codip-proxy-secret": "unit-test-proxy-secret-1234567890",
      },
    });
    const response = await requireRole(req, ["engineer"], async () => "engineer");
    expect(response).toBeNull();
    vi.unstubAllEnvs();
  });

  it("rejects a spoofed identity header without the proxy secret", async () => {
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "unit-test-proxy-secret-1234567890");
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "engineer@example.com" },
    });
    const response = await requireRole(req, ["engineer"], async () => "engineer");
    expect(response?.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it("lets an existing admin authentication bypass the role check", async () => {
    vi.doMock("@/lib/admin-auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/admin-auth")>()),
      requireAdminRequest: () => null,
    }));
    const { requireRoleOrAdmin: guard } = await import("../../src/lib/rbac");
    const req = new NextRequest("http://localhost/api/v1/sites");
    const response = await guard(req, ["engineer"], async () => "viewer");
    expect(response).toBeNull();
  });

  it("applies the role check when admin authentication fails", async () => {
    vi.doMock("@/lib/admin-auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/admin-auth")>()),
      requireAdminRequest: () => ({ status: 403 }),
    }));
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "true");
    vi.stubEnv("CODIP_TRUST_PROXY_SECRET", "unit-test-proxy-secret-1234567890");
    const { requireRoleOrAdmin: guard } = await import("../../src/lib/rbac");
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: {
        "x-codip-user": "engineer@example.com",
        "x-codip-proxy-secret": "unit-test-proxy-secret-1234567890",
      },
    });
    const allowed = await guard(req, ["engineer"], async () => "engineer");
    expect(allowed).toBeNull();

    const deniedReq = new NextRequest("http://localhost/api/v1/sites", {
      headers: {
        "x-codip-user": "viewer@example.com",
        "x-codip-proxy-secret": "unit-test-proxy-secret-1234567890",
      },
    });
    const denied = await guard(deniedReq, ["engineer"], async () => "viewer");
    expect(denied?.status).toBe(403);
    vi.unstubAllEnvs();
  });
});
