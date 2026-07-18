import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const dataSourceFindManyMock = vi.hoisted(() => vi.fn());
const dataSourceCountMock = vi.hoisted(() => vi.fn());
const dataSourceFindUniqueMock = vi.hoisted(() => vi.fn());
const dataSourceUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    dataSource: {
      findMany: dataSourceFindManyMock,
      count: dataSourceCountMock,
      findUnique: dataSourceFindUniqueMock,
      update: dataSourceUpdateMock,
    },
  },
}));

import { GET as sourcesGET } from "@/app/api/sources/route";
import { PUT as sourcePUT } from "@/app/api/sources/[id]/route";

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("sources API route", () => {
  it("does not use internal notes as public search fields", async () => {
    dataSourceFindManyMock.mockResolvedValueOnce([]);
    dataSourceCountMock.mockResolvedValueOnce(0);

    const response = await sourcesGET(new NextRequest("http://localhost/api/sources?q=internal-note"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ items: [], total: 0 });
    expect(dataSourceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "internal-note" } },
            { nameEn: { contains: "internal-note" } },
            { description: { contains: "internal-note" } },
          ],
        },
      }),
    );
  });
});

describe("sources PUT route: requiresApiKey→HTTPS 不変条件のマージ後検査", () => {
  const ADMIN_TOKEN = "unit-test-admin-token-1234567890123456";

  function adminPut(body: unknown) {
    return new NextRequest("http://localhost/api/sources/src-1", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-codip-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify(body),
    });
  }

  const routeContext = { params: Promise.resolve({ id: "src-1" }) };

  const existingApiKeySource = {
    id: "src-1",
    providerId: "prov-1",
    name: "既存ソース",
    officialUrl: "https://secure.example.jp/data",
    endpointUrl: null,
    requiresApiKey: true,
  };

  function stubAdminEnv() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CODIP_ADMIN_TOKEN", ADMIN_TOKEN);
    vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "false");
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "false");
  }

  it("Codex adversarial 指摘: URL のみ http へ部分更新すると 400 (不変条件維持)", async () => {
    stubAdminEnv();
    dataSourceFindUniqueMock.mockResolvedValueOnce(existingApiKeySource);

    const response = await sourcePUT(
      adminPut({ officialUrl: "http://insecure.example.jp/data" }),
      routeContext,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("validation_error");
    expect(body.details.fieldErrors.officialUrl?.[0]).toContain("HTTPS");
    expect(dataSourceUpdateMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("Codex review 指摘: APIキー関連フィールドのみの部分更新は既存 https URL があれば成功する", async () => {
    stubAdminEnv();
    const existing = { ...existingApiKeySource, requiresApiKey: false };
    dataSourceFindUniqueMock.mockResolvedValueOnce(existing);
    dataSourceUpdateMock.mockResolvedValueOnce({
      ...existing,
      requiresApiKey: true,
      apiKeyEnvName: "ESTAT_APP_ID",
      provider: { id: "prov-1", name: "テスト提供元" },
      tags: [],
    });

    const response = await sourcePUT(
      adminPut({ requiresApiKey: true, apiKeyEnvName: "ESTAT_APP_ID" }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(dataSourceUpdateMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("既存が http のまま requiresApiKey=true へ部分更新することも 400 で拒否する", async () => {
    stubAdminEnv();
    dataSourceFindUniqueMock.mockResolvedValueOnce({
      ...existingApiKeySource,
      officialUrl: "http://legacy.example.jp/data",
      requiresApiKey: false,
    });

    const response = await sourcePUT(adminPut({ requiresApiKey: true }), routeContext);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.details.fieldErrors.officialUrl?.[0]).toContain("HTTPS");
    expect(dataSourceUpdateMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
