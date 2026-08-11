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
// ルートクライアント直書きの書き込みを検出するための独立モック。
// $transaction 経由の書き込みは上記の tx 用モックだけを使い、これらは一切呼ばれない。
const rootDataSourceUpdateMock = vi.hoisted(() => vi.fn());
const rootFetchLogCreateMock = vi.hoisted(() => vi.fn());
const rootAuditLogCreateMock = vi.hoisted(() => vi.fn());
const connectorCheckMock = vi.hoisted(() => vi.fn());
const connectorFetchSampleMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    dataSource: {
      findUnique: dataSourceFindUniqueMock,
      update: rootDataSourceUpdateMock,
    },
    fetchLog: {
      count: fetchLogCountMock,
      create: rootFetchLogCreateMock,
    },
    // /api/admin/audit-events は transaction を張らず直接 INSERT する経路。
    auditLog: {
      create: rootAuditLogCreateMock,
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
import { POST as auditEventsPOST } from "@/app/api/admin/audit-events/route";

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

function adminPostJson(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "x-codip-admin-token": ADMIN_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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

/**
 * ADR 0002 の「監査INSERT失敗時は 503」「業務側更新と同一transaction」は、
 * check-audit-contract.js では該当コメント文字列の存在しか見ていない (Issue #134)。
 * 上の3件は正常系のみなので、監査INSERTを落とす経路は実測されていなかった。
 * ここでは失敗系だけを測る。主張は1つだが、503 を返す経路 (業務更新を持たない
 * /api/admin/audit-events) と rollback が効く経路 (transaction を張る業務API) が
 * 実装上別ルートなので、対応する2ケースで測る。
 */
describe("audit insert failure path", () => {
  it("returns 503 audit_record_failed when the direct audit insert fails", async () => {
    stubAdminEnv();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rootAuditLogCreateMock.mockRejectedValueOnce(new Error("audit insert failed"));

    const response = await auditEventsPOST(
      adminPostJson("/api/admin/audit-events", { kind: "audit_export_csv" }),
    );
    const body = await response.json();

    // route.ts の catch を status: 200 に書き換えると、ここで落ちる。
    expect(response.status).toBe(503);
    expect(body.error).toBe("audit_record_failed");
    expect(body.ok).toBeUndefined();
    expect(rootAuditLogCreateMock).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("aborts the whole transaction when the audit insert fails instead of committing the business writes", async () => {
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
    fetchLogCreateMock.mockResolvedValueOnce({ id: "log-3" });
    dataSourceUpdateMock.mockResolvedValueOnce({});
    auditLogCreateMock.mockRejectedValueOnce(new Error("audit insert failed"));

    // 監査INSERTの失敗が $transaction の外まで伝播することが rollback の前提条件。
    // tx.auditLog.create を try/catch で握り潰す改変を入れると 200 が返り、
    // 業務側の fetch_logs / data_sources 更新だけが commit されてしまう。
    await expect(
      sourceCheckPOST(adminPost("/api/sources/src-1/check"), routeContext),
    ).rejects.toThrow("audit insert failed");

    // 業務側の書き込みは監査INSERTより前に同一transaction内で実行済み。
    // つまり握り潰された場合に commit される対象が実在することを示す。
    expect(fetchLogCreateMock).toHaveBeenCalledTimes(1);
    expect(dataSourceUpdateMock).toHaveBeenCalledTimes(1);
    // 業務書き込みと監査書き込みは tx 経由のみで実行され、ルートクライアントの
    // 書き込みモックには到達しないこと（transaction 外へ漏れた場合に検出する）。
    expect(rootFetchLogCreateMock).not.toHaveBeenCalled();
    expect(rootDataSourceUpdateMock).not.toHaveBeenCalled();
    expect(rootAuditLogCreateMock).not.toHaveBeenCalled();
  });
});
