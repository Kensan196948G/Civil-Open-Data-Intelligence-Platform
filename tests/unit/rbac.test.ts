import { NextRequest } from "next/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createRoleResolver,
  normalizeEmail,
  requireRole,
  requireRoleOrAdmin,
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
  const store = new Map<string, string>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => {
      store.set(k, v);
    },
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

  it("reads the injected user header with fallback", () => {
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "Field@Example.com" },
    });
    expect(userEmailFromRequest(req)).toBe("field@example.com");

    const fallback = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "cf-access-authenticated-user-email": "Back@Example.com" },
    });
    expect(userEmailFromRequest(fallback)).toBe("back@example.com");

    const none = new NextRequest("http://localhost/api/v1/sites");
    expect(userEmailFromRequest(none)).toBeNull();
  });
});

describe("requireRole / requireRoleOrAdmin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 without a user identity", async () => {
    const req = new NextRequest("http://localhost/api/v1/sites");
    const response = await requireRole(req, ["engineer"], async () => "viewer");
    expect(response?.status).toBe(401);
  });

  it("returns 403 when the role is not allowed", async () => {
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "viewer@example.com" },
    });
    const response = await requireRole(req, ["engineer"], async () => "viewer");
    expect(response?.status).toBe(403);
    const body = await response?.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("allows an allowed role", async () => {
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "engineer@example.com" },
    });
    const response = await requireRole(req, ["engineer"], async () => "engineer");
    expect(response).toBeNull();
  });

  it("lets an existing admin authentication bypass the role check", async () => {
    vi.doMock("@/lib/admin-auth", () => ({
      requireAdminRequest: () => null,
    }));
    const { requireRoleOrAdmin: guard } = await import("../../src/lib/rbac");
    const req = new NextRequest("http://localhost/api/v1/sites");
    const response = await guard(req, ["engineer"], async () => "viewer");
    expect(response).toBeNull();
  });

  it("applies the role check when admin authentication fails", async () => {
    vi.doMock("@/lib/admin-auth", () => ({
      requireAdminRequest: () => ({ status: 403 }),
    }));
    const { requireRoleOrAdmin: guard } = await import("../../src/lib/rbac");
    const req = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "engineer@example.com" },
    });
    const allowed = await guard(req, ["engineer"], async () => "engineer");
    expect(allowed).toBeNull();

    const deniedReq = new NextRequest("http://localhost/api/v1/sites", {
      headers: { "x-codip-user": "viewer@example.com" },
    });
    const denied = await guard(deniedReq, ["engineer"], async () => "viewer");
    expect(denied?.status).toBe(403);
  });
});
