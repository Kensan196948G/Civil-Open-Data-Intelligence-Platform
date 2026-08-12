import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const roleFindUniqueMock = vi.hoisted(() => vi.fn());
const assignmentFindManyMock = vi.hoisted(() => vi.fn());
const assignmentFindFirstMock = vi.hoisted(() => vi.fn());
const assignmentCreateMock = vi.hoisted(() => vi.fn());
const assignmentFindUniqueMock = vi.hoisted(() => vi.fn());
const assignmentUpdateMock = vi.hoisted(() => vi.fn());
const assignmentUpdateManyMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    role: { findUnique: roleFindUniqueMock },
    roleAssignment: {
      findMany: assignmentFindManyMock,
      findFirst: assignmentFindFirstMock,
      findUnique: assignmentFindUniqueMock,
      create: assignmentCreateMock,
      update: assignmentUpdateMock,
      updateMany: assignmentUpdateManyMock,
    },
    auditLog: { create: auditLogCreateMock },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        roleAssignment: {
          create: assignmentCreateMock,
          update: assignmentUpdateMock,
          updateMany: assignmentUpdateManyMock,
        },
        auditLog: { create: auditLogCreateMock },
      }),
  },
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: (request: NextRequest) =>
    request.headers.get("x-codip-admin-token") === "ok" ? null : { status: 401 },
}));

import { GET, POST } from "@/app/api/admin/roles/route";
import { DELETE } from "@/app/api/admin/roles/[id]/route";

function adminGet(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { "x-codip-admin-token": "ok" },
  });
}

function adminPost(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "x-codip-admin-token": "ok", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminDelete(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: "DELETE",
    headers: { "x-codip-admin-token": "ok" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("admin roles API", () => {
  it("requires admin authentication", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/roles"));
    expect(response.status).toBe(401);
  });

  it("lists roles and active assignments", async () => {
    assignmentFindManyMock.mockResolvedValue([
      {
        id: "a-1",
        userEmail: "engineer@example.com",
        scope: "global",
        grantedBy: "admin",
        expiresAt: null,
        createdAt: new Date(),
        role: { name: "engineer", priority: 20 },
      },
    ]);
    const response = await GET(adminGet("/api/admin/roles"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.roles).toContain("engineer");
    expect(body.data.assignments[0].role).toBe("engineer");
  });

  it("rejects an invalid email", async () => {
    const response = await POST(
      adminPost("/api/admin/roles", { userEmail: "not-an-email", role: "engineer" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown role", async () => {
    const response = await POST(
      adminPost("/api/admin/roles", { userEmail: "a@example.com", role: "superuser" }),
    );
    expect(response.status).toBe(400);
  });

  it("creates an assignment and writes an audit record in the same transaction", async () => {
    roleFindUniqueMock.mockResolvedValue({ id: "role-engineer", name: "engineer" });
    assignmentFindFirstMock.mockResolvedValue(null);
    assignmentUpdateManyMock.mockResolvedValue({ count: 0 });
    assignmentCreateMock.mockResolvedValue({ id: "a-2", userEmail: "a@example.com" });

    const response = await POST(
      adminPost("/api/admin/roles", {
        userEmail: "A@Example.com",
        role: "engineer",
        scope: "global",
        grantedBy: "spoofed-actor",
      }),
    );
    expect(response.status).toBe(201);
    expect(assignmentCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userEmail: "a@example.com",
          // 実行者はサーバー固定（クライアント入力の grantedBy は使わない）
          grantedBy: "admin",
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "role.assign" }) }),
    );
  });

  it("rejects a duplicate active assignment", async () => {
    roleFindUniqueMock.mockResolvedValue({ id: "role-engineer", name: "engineer" });
    assignmentFindFirstMock.mockResolvedValue({ id: "a-1" });
    assignmentUpdateManyMock.mockResolvedValue({ count: 0 });
    const response = await POST(
      adminPost("/api/admin/roles", { userEmail: "a@example.com", role: "engineer" }),
    );
    expect(response.status).toBe(409);
    expect(assignmentCreateMock).not.toHaveBeenCalled();
  });

  it("revokes an assignment and writes an audit record", async () => {
    assignmentFindUniqueMock.mockResolvedValue({
      id: "a-3",
      userEmail: "b@example.com",
      scope: "global",
      revokedAt: null,
    });
    assignmentUpdateManyMock.mockResolvedValue({ count: 1 });
    const response = await DELETE(
      adminDelete("/api/admin/roles/a-3"),
      { params: Promise.resolve({ id: "a-3" }) },
    );
    expect(response.status).toBe(200);
    expect(assignmentUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "a-3", revokedAt: null }),
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "role.revoke" }) }),
    );
  });

  it("returns 404 for an unknown or already revoked assignment", async () => {
    assignmentFindUniqueMock.mockResolvedValue(null);
    const response = await DELETE(
      adminDelete("/api/admin/roles/missing"),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(response.status).toBe(404);
  });

  it("revokes an expired assignment before allowing a re-grant", async () => {
    roleFindUniqueMock.mockResolvedValue({ id: "role-engineer", name: "engineer" });
    assignmentFindFirstMock.mockResolvedValue(null);
    assignmentUpdateManyMock.mockResolvedValue({ count: 1 });
    assignmentCreateMock.mockResolvedValue({ id: "a-4", userEmail: "c@example.com" });

    const response = await POST(
      adminPost("/api/admin/roles", {
        userEmail: "c@example.com",
        role: "engineer",
        expiresAt: "2026-08-11T00:00:00Z",
      }),
    );
    expect(response.status).toBe(201);
    expect(assignmentUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          revokedAt: null,
          expiresAt: { lte: expect.any(Date) },
        }),
      }),
    );
  });
});
