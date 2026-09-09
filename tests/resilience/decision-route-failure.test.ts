import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

/**
 * Resilience / Fail-Safe テスト (Gate 4) — 依存障害時の判定 API。
 *
 * 不変条件 (docs/quality/RELEASE_CRITERIA.md C1):
 *   「DB や外部依存が障害したとき、判定 API は誤った値 (go) を
 *    正常結果として返さない」
 *
 * 正常系・fail-closed 論理は tests/unit/decision-engine.test.ts と
 * tests/golden/ が担保する。ここでは依存 (prisma) が例外を投げたとき、
 * ルートがハンドラ内で握り潰して 200 + 判定値を返さないことを検証する。
 */

const findUniqueMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());
const weatherFirstMock = vi.hoisted(() => vi.fn());
const marineFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const requireRoleOrAdminMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    constructionSite: { findUnique: findUniqueMock },
    weatherThreshold: { findMany: findManyMock },
    weatherObservation: { findFirst: weatherFirstMock },
    marineObservation: { findFirst: marineFirstMock },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireRoleOrAdmin: requireRoleOrAdminMock,
}));

import { POST } from "@/app/api/v1/decisions/route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/decisions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  siteId: "site_1",
  workType: "concrete",
  targetWindowStart: "2026-09-10T00:00:00+09:00",
  targetWindowEnd: "2026-09-10T12:00:00+09:00",
};

function makeSite() {
  return { id: "site_1", code: "SITE-01" };
}

/** 依存障害時に「200 + 判定値」を返さないことを検証するヘルパ */
async function expectNoFabricatedDecision(promise: Promise<Response>) {
  let response: Response | undefined;
  let rejected = false;
  try {
    response = await promise;
  } catch {
    rejected = true;
  }
  if (!rejected) {
    expect(response?.status).toBeGreaterThanOrEqual(500);
    const body = await response?.json();
    expect(body?.data?.decision).toBeUndefined();
    expect(body?.data?.status).toBeUndefined();
  }
  // どちらの経路でも判定レコードは作成されない
  expect(transactionMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  requireRoleOrAdminMock.mockResolvedValue(null);
  resetRateLimitForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v1/decisions under dependency failure", () => {
  it("R-RES-1: 現場照会の DB 障害時に判定値を返さない (fail-safe)", async () => {
    findUniqueMock.mockRejectedValue(new Error("db unavailable"));
    await expectNoFabricatedDecision(POST(request(validBody)));
  });

  it("R-RES-2: 観測値照会の DB 障害時に判定値を返さない (fail-safe)", async () => {
    findUniqueMock.mockResolvedValue(makeSite());
    findManyMock.mockResolvedValue([
      {
        workType: "concrete",
        metric: "precipMm1h",
        op: ">=",
        value: 10,
        severity: "stop",
        note: null,
        activeFrom: null,
        activeTo: null,
      },
    ]);
    weatherFirstMock.mockRejectedValue(new Error("observation store unavailable"));
    marineFirstMock.mockResolvedValue(null);
    await expectNoFabricatedDecision(POST(request(validBody)));
  });

  it("R-RES-3: 正常系では監査トランザクションまで到達する (対照テスト)", async () => {
    findUniqueMock.mockResolvedValue(makeSite());
    findManyMock.mockResolvedValue([]);
    weatherFirstMock.mockResolvedValue({
      temperatureC: 20,
      humidityPct: 50,
      precipMm: 0,
      windSpeedMs: 3,
      windGustMs: 5,
    });
    marineFirstMock.mockResolvedValue(null);
    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        decisionRecord: {
          create: vi.fn().mockResolvedValue({
            id: "d1",
            siteId: "site_1",
            workType: "concrete",
            targetWindowStart: new Date(),
            targetWindowEnd: new Date(),
            status: "caution",
            reason: "x",
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }),
    );
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    const body = await response.json();
    // ルール未設定 → go ではなく caution (fail-closed)
    expect(body.data.decision.status).toBe("caution");
  });
});
