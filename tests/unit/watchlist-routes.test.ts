import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const findManyMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());
const deleteManyMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    watchlistEntry: {
      findMany: findManyMock,
      findUnique: findUniqueMock,
      create: createMock,
      deleteMany: deleteManyMock,
    },
    auditLog: { create: auditLogCreateMock },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        watchlistEntry: { create: createMock, deleteMany: deleteManyMock },
        auditLog: { create: auditLogCreateMock },
      }),
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireRoleOrAdmin: async () => null,
  userEmailFromRequest: () => "u@example.com",
  normalizeEmail: (v: string) => v.trim().toLowerCase(),
}));

import { GET, POST } from "@/app/api/v1/watchlist/route";
import { DELETE } from "@/app/api/v1/watchlist/[id]/route";

function req(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("watchlist API", () => {
  it("lists own entries", async () => {
    findManyMock.mockResolvedValue([{ id: "w1", userEmail: "u@example.com", targetType: "site", targetId: "s1" }]);
    const response = await GET(req("/api/v1/watchlist"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.entries[0].targetId).toBe("s1");
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userEmail: "u@example.com" }) }),
    );
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
});
