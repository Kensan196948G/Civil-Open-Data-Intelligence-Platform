import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const dataSourceFindUniqueMock = vi.hoisted(() => vi.fn());
const dataSourceUpdateMock = vi.hoisted(() => vi.fn());
const fetchLogCreateMock = vi.hoisted(() => vi.fn());
const fetchLogCountMock = vi.hoisted(() => vi.fn());
const sampleResponseCreateMock = vi.hoisted(() => vi.fn());
const qualityCheckCreateMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());
const connectorCheckMock = vi.hoisted(() => vi.fn());
const connectorFetchSampleMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    dataSource: {
      findUnique: dataSourceFindUniqueMock,
      update: dataSourceUpdateMock,
    },
    fetchLog: {
      count: fetchLogCountMock,
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        dataSource: { update: dataSourceUpdateMock },
        fetchLog: { create: fetchLogCreateMock },
        sampleResponse: { create: sampleResponseCreateMock },
        qualityCheck: { create: qualityCheckCreateMock },
        auditLog: { create: auditLogCreateMock },
      }),
  },
}));

vi.mock("@/connectors/registry", () => ({
  findConnector: () => ({
    name: "mock-connector",
    check: connectorCheckMock,
    fetchSample: connectorFetchSampleMock,
  }),
}));

vi.mock("@/lib/settings", () => ({
  getOperationSettings: () => Promise.resolve({ previewKb: 4, staleDays: 90 }),
}));

import { POST as sourceCheckPOST } from "@/app/api/sources/[id]/check/route";
import { POST as sourceFetchSamplePOST } from "@/app/api/sources/[id]/fetch-sample/route";
import { POST as qualityRecalculatePOST } from "@/app/api/quality/[id]/recalculate/route";

const ADMIN_TOKEN = "unit-test-admin-token-1234567890123456";
const routeContext = { params: Promise.resolve({ id: "src-1" }) };

function stubAdminEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CODIP_ADMIN_TOKEN", ADMIN_TOKEN);
  vi.stubEnv("CODIP_TRUST_PROXY_AUTH", "false");
  vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "false");
}

function adminPost(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "x-codip-admin-token": ADMIN_TOKEN,
    },
  });
}

function sourceFixture() {
  return {
    id: "src-1",
    name: "監査対象ソース",
    officialUrl: "https://example.jp/data",
    endpointUrl: null,
    requiresApiKey: false,
    provider: { id: "prov-1", name: "提供元", organizationType: "national" },
    lastCheckedAt: new Date("2026-07-01T00:00:00.000Z"),
    licenseName: "政府標準利用規約",
    commercialUse: "allowed",
    dataFormat: "JSON",
    category: "gis",
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resetRateLimitForTests();
});

describe("operational audit transaction routes", () => {
  it("records source check fetch log, status update, and audit event in one transaction", async () => {
    stubAdminEnv();
    dataSourceFindUniqueMock.mockResolvedValueOnce(sourceFixture());
    connectorCheckMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      responseTimeMs: 42,
      responseSizeBytes: 128,
      contentType: "application/json",
      finalUrl: "https://example.jp/data",
    });
    fetchLogCreateMock.mockResolvedValueOnce({ id: "log-1" });
    dataSourceUpdateMock.mockResolvedValueOnce({});
    auditLogCreateMock.mockResolvedValueOnce({});

    const response = await sourceCheckPOST(adminPost("/api/sources/src-1/check"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logId).toBe("log-1");
    expect(fetchLogCreateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ executionType: "check" }) }));
    expect(dataSourceUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "src-1" } }));
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "接続確認実行",
        target: "監査対象ソース",
        detail: "疎通確認 成功",
        level: "success",
      },
    });
  });

  it("records sample fetch log, sample response, status update, and audit event in one transaction", async () => {
    stubAdminEnv();
    dataSourceFindUniqueMock.mockResolvedValueOnce(sourceFixture());
    connectorFetchSampleMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      responseTimeMs: 52,
      responseSizeBytes: 256,
      contentType: "application/json",
      finalUrl: "https://example.jp/data",
      detectedFormat: "JSON",
      previewText: "{\"ok\":true}",
    });
    fetchLogCreateMock.mockResolvedValueOnce({ id: "log-2" });
    sampleResponseCreateMock.mockResolvedValueOnce({ id: "sample-1" });
    dataSourceUpdateMock.mockResolvedValueOnce({});
    auditLogCreateMock.mockResolvedValueOnce({});

    const response = await sourceFetchSamplePOST(adminPost("/api/sources/src-1/fetch-sample"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logId).toBe("log-2");
    expect(body.sampleId).toBe("sample-1");
    expect(sampleResponseCreateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fetchLogId: "log-2" }) }));
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "サンプル取得実行",
        target: "監査対象ソース",
        detail: "サンプルデータを取得",
        level: "success",
      },
    });
  });

  it("records quality check, quality score update, and audit event in one transaction", async () => {
    stubAdminEnv();
    dataSourceFindUniqueMock.mockResolvedValueOnce(sourceFixture());
    fetchLogCountMock.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    qualityCheckCreateMock.mockResolvedValueOnce({ id: "quality-1", dataSourceId: "src-1" });
    dataSourceUpdateMock.mockResolvedValueOnce({});
    auditLogCreateMock.mockResolvedValueOnce({});

    const response = await qualityRecalculatePOST(adminPost("/api/quality/src-1/recalculate"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("quality-1");
    expect(qualityCheckCreateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dataSourceId: "src-1" }) }));
    expect(dataSourceUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "src-1" } }));
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "品質スコア再計算",
        target: "監査対象ソース",
        detail: expect.stringMatching(/^スコア: \d+$/),
        level: "info",
      },
    });
  });
});
