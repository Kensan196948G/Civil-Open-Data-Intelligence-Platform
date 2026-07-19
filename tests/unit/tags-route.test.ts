import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const tagFindManyMock = vi.hoisted(() => vi.fn());
const tagFindUniqueMock = vi.hoisted(() => vi.fn());
const tagCreateMock = vi.hoisted(() => vi.fn());
const tagDeleteMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    tag: {
      findMany: tagFindManyMock,
      findUnique: tagFindUniqueMock,
      create: tagCreateMock,
      delete: tagDeleteMock,
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        tag: {
          create: tagCreateMock,
          delete: tagDeleteMock,
        },
        auditLog: { create: auditLogCreateMock },
      }),
  },
}));

import { DELETE as tagDELETE } from "@/app/api/tags/[id]/route";
import { GET as tagsGET, POST as tagsPOST } from "@/app/api/tags/route";

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("tags API route", () => {
  const ADMIN_TOKEN = "unit-test-admin-token-1234567890123456";

  function stubAdminEnv() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", ADMIN_TOKEN);
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "false");
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "false");
  }

  function adminPost(body: unknown) {
    return new NextRequest("http://localhost/api/tags", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-codip-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify(body),
    });
  }

  function adminDelete() {
    return new NextRequest("http://localhost/api/tags/tag-1", {
      method: "DELETE",
      headers: {
        "x-codip-admin-token": ADMIN_TOKEN,
      },
    });
  }

  it("rate limits public tag reads", async () => {
    tagFindManyMock.mockResolvedValue([]);

    let response = await tagsGET(new NextRequest("http://localhost/api/tags"));
    expect(response.status).toBe(200);

    for (let index = 0; index < 119; index += 1) {
      response = await tagsGET(new NextRequest("http://localhost/api/tags"));
      expect(response.status).toBe(200);
    }

    response = await tagsGET(new NextRequest("http://localhost/api/tags"));
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.error).toBe("rate_limited");
  });

  it("records tag creation audit event in the same transaction", async () => {
    stubAdminEnv();
    tagFindUniqueMock.mockResolvedValueOnce(null);
    tagCreateMock.mockResolvedValueOnce({ id: "tag-1", name: "防災", color: "#336699" });

    const response = await tagsPOST(adminPost({ name: "防災", color: "#336699" }));

    expect(response.status).toBe(201);
    expect(tagCreateMock).toHaveBeenCalledWith({ data: { name: "防災", color: "#336699" } });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "タグ追加",
        target: "防災",
        detail: "新規タグを登録",
        level: "info",
      },
    });
    vi.unstubAllEnvs();
  });

  it("records tag deletion audit event in the same transaction", async () => {
    stubAdminEnv();
    tagFindUniqueMock.mockResolvedValueOnce({ id: "tag-1", name: "防災" });
    tagDeleteMock.mockResolvedValueOnce({ id: "tag-1", name: "防災" });

    const response = await tagDELETE(adminDelete(), { params: Promise.resolve({ id: "tag-1" }) });

    expect(response.status).toBe(200);
    expect(tagDeleteMock).toHaveBeenCalledWith({ where: { id: "tag-1" } });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "タグ削除",
        target: "防災",
        detail: "タグを削除",
        level: "danger",
      },
    });
    vi.unstubAllEnvs();
  });
});
