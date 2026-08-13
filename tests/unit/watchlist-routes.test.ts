import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const findManyMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const deleteManyMock = vi.hoisted(() => vi.fn());
const findFirstMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());
const requireRoleOrAdminMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    watchlistEntry: {
      findMany: findManyMock,
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
      create: createMock,
      deleteMany: deleteManyMock,
      update: updateMock,
    },
    auditLog: { create: auditLogCreateMock },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        watchlistEntry: {
          create: createMock,
          deleteMany: deleteManyMock,
          findFirst: findFirstMock,
          update: updateMock,
        },
        auditLog: { create: auditLogCreateMock },
      }),
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireRoleOrAdmin: requireRoleOrAdminMock,
  userEmailFromRequest: vi.fn(() => "u@example.com"),
  normalizeEmail: (v: string) => v.trim().toLowerCase(),
}));

import { GET, POST } from "@/app/api/v1/watchlist/route";
import { DELETE, PATCH } from "@/app/api/v1/watchlist/[id]/route";
import { requireRoleOrAdmin, userEmailFromRequest } from "@/lib/rbac";

function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  requireRoleOrAdminMock.mockResolvedValue(null);
  resetRateLimitForTests();
});

describe("watchlist API", () => {
  it("lists own entries", async () => {
    findManyMock.mockResolvedValue([{ id: "w1", userEmail: "u@example.com", targetType: "site", targetId: "s1" }]);
    const response = await GET(req("/api/v1/watchlist"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.identity).toBe("u@example.com");
    expect(body.data.entries[0].targetId).toBe("s1");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userEmail: "u@example.com" } }),
    );
  });

  it("auditor をウォッチリスト許可ロールへ渡さない (rbac-design 整合)", async () => {
    findManyMock.mockResolvedValue([]);
    await GET(req("/api/v1/watchlist"));
    await POST(req("/api/v1/watchlist", "POST", { targetType: "site", targetId: "s1" })).catch(
      () => undefined,
    );
    await DELETE(req("/api/v1/watchlist/w1", "DELETE"), { params: Promise.resolve({ id: "w1" }) }).catch(
      () => undefined,
    );
    await PATCH(
      req("/api/v1/watchlist/w1", "PATCH", { enabled: false }),
      { params: Promise.resolve({ id: "w1" }) },
    ).catch(() => undefined);

    const passedRoles = requireRoleOrAdminMock.mock.calls.flatMap((call) =>
      (call[1] as readonly string[]).map((role) => role),
    );
    expect(passedRoles.length).toBeGreaterThan(0);
    expect(passedRoles).not.toContain("auditor");
    expect(passedRoles).toEqual(expect.arrayContaining(["engineer", "data-steward", "admin"]));
  });

  it("rejects invalid target type", async () => {
    const response = await POST(
      req("/api/v1/watchlist", "POST", { targetType: "invalid", targetId: "x" }),
    );
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates an entry and writes an audit record", async () => {
    findUniqueMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "w2", userEmail: "u@example.com", targetType: "dataSource", targetId: "d1" });
    const response = await POST(
      req("/api/v1/watchlist", "POST", { targetType: "dataSource", targetId: "d1" }),
    );
    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userEmail: "u@example.com" }) }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "watchlist.add" }) }),
    );
  });

  it("rejects a duplicate entry", async () => {
    findUniqueMock.mockResolvedValue({ id: "w1" });
    const response = await POST(
      req("/api/v1/watchlist", "POST", { targetType: "site", targetId: "s1" }),
    );
    expect(response.status).toBe(409);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("deletes only own entries", async () => {
    deleteManyMock.mockResolvedValue({ count: 1 });
    const response = await DELETE(req("/api/v1/watchlist/w1", "DELETE"), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(response.status).toBe(200);
    expect(deleteManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "w1", userEmail: "u@example.com" }) }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "watchlist.remove" }) }),
    );
  });

  it("returns 404 when nothing was deleted", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });
    const response = await DELETE(req("/api/v1/watchlist/missing", "DELETE"), {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(response.status).toBe(404);
  });

  it("toggles enabled via PATCH and writes an audit record", async () => {
    findFirstMock.mockResolvedValue({ id: "w1", userEmail: "u@example.com" });
    updateMock.mockResolvedValue({
      id: "w1",
      userEmail: "u@example.com",
      targetType: "site",
      targetId: "s1",
      enabled: false,
    });
    const response = await PATCH(req("/api/v1/watchlist/w1", "PATCH", { enabled: false }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.entry.enabled).toBe(false);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w1", userEmail: "u@example.com" } }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "watchlist.toggle" }) }),
    );
  });

  it("rejects PATCH without a boolean enabled field", async () => {
    const response = await PATCH(req("/api/v1/watchlist/w1", "PATCH", { enabled: "yes" }), {
      params: Promise.resolve({ id: "w1" }),
    });
    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 404 when PATCH target does not belong to the user", async () => {
    findFirstMock.mockResolvedValue(null);
    const response = await PATCH(req("/api/v1/watchlist/other", "PATCH", { enabled: true }), {
      params: Promise.resolve({ id: "other" }),
    });
    expect(response.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("falls back to the demo identity only when proxy identity is absent", async () => {
    vi.stubEnv("CODIP_DEMO_IDENTITY", "true");
    vi.stubEnv("CODIP_DEMO_USER_EMAIL", "demo.engineer@example.com");
    (userEmailFromRequest as Mock).mockReturnValueOnce(null);
    findManyMock.mockResolvedValue([]);
    const response = await GET(req("/api/v1/watchlist"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.identity).toBe("demo.engineer@example.com");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userEmail: "demo.engineer@example.com" } }),
    );
    vi.unstubAllEnvs();
  });
});
