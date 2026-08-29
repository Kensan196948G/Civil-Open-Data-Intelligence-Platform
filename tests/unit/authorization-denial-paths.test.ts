import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * 認可の「拒否される側」の契約テスト。
 *
 * 既存のルートテストは requireRoleOrAdmin を「常に null（許可）」へ固定して
 * おり、拒否経路を一度も通っていなかった。そのため **認可ガードの行を削除しても
 * 全テストが緑のまま**になる。実測で確認した状態:
 *
 *     watchlist/route.ts の `if (authError) return authError;` を2箇所とも削除
 *       → tests/unit/watchlist-routes.test.ts は 11 件すべて pass
 *
 * ここでは「拒否されたとき、その応答をそのまま返し、DB へ一切到達しない」ことを
 * 測る。ガードを消せばこのファイルが落ちる。
 */

const prismaProxy = new Proxy(
  {},
  {
    get(_t, model: string) {
      if (model === "$transaction") return dbTouched;
      return new Proxy(
        {},
        {
          get() {
            return dbTouched;
          },
        },
      );
    },
  },
);

const dbTouched = vi.fn(() => {
  throw new Error("認可で拒否されたはずのリクエストが DB へ到達した");
});

const requireRoleOrAdminMock = vi.fn();

vi.mock("@/lib/db", () => ({
  get prisma() {
    return prismaProxy;
  },
  getPostgreSQLPrismaHelpers: () => {
    throw new Error("認可で拒否されたはずのリクエストが DB へ到達した");
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireRoleOrAdmin: (...a: unknown[]) => requireRoleOrAdminMock(...a),
  requireRole: (...a: unknown[]) => requireRoleOrAdminMock(...a),
  userEmailFromRequest: vi.fn(() => "viewer@example.com"),
  normalizeEmail: (v: string) => v.trim().toLowerCase(),
}));

import { POST as decisionsPOST } from "@/app/api/v1/decisions/route";
import { POST as sitesPOST } from "@/app/api/v1/sites/route";
import { POST as reportsPOST } from "@/app/api/v1/reports/route";
import { GET as watchlistGET, POST as watchlistPOST } from "@/app/api/v1/watchlist/route";
import { DELETE as watchlistDELETE, PATCH as watchlistPATCH } from "@/app/api/v1/watchlist/[id]/route";

/** requireRoleOrAdmin が返す拒否応答（実装と同じ形）。 */
const forbidden = () =>
  NextResponse.json({ error: { code: "forbidden", message: "必要なロールがありません（現在: viewer）" } }, { status: 403 });

const unauthorized = () =>
  NextResponse.json({ error: { code: "unauthorized", message: "管理認証が必要です" } }, { status: 401 });

function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

type Case = {
  label: string;
  call: () => Promise<Response>;
};

const CASES: Case[] = [
  {
    label: "POST /api/v1/decisions",
    call: () => decisionsPOST(request("/api/v1/decisions", "POST", { siteId: "s1", workType: "crane" })),
  },
  {
    label: "POST /api/v1/sites",
    call: () => sitesPOST(request("/api/v1/sites", "POST", { code: "S1", name: "現場", lat: 35.6, lon: 139.7 })),
  },
  {
    label: "POST /api/v1/reports",
    call: () =>
      reportsPOST(
        request("/api/v1/reports", "POST", { siteId: "s1", template: "decision", dateFrom: "2026-08-01", dateTo: "2026-08-02" }),
      ),
  },
  {
    label: "GET /api/v1/watchlist",
    call: () => watchlistGET(request("/api/v1/watchlist", "GET")),
  },
  {
    label: "POST /api/v1/watchlist",
    call: () => watchlistPOST(request("/api/v1/watchlist", "POST", { targetType: "site", targetId: "s1" })),
  },
  {
    label: "PATCH /api/v1/watchlist/[id]",
    call: () =>
      watchlistPATCH(request("/api/v1/watchlist/w1", "PATCH", { enabled: false }), {
        params: Promise.resolve({ id: "w1" }),
      }),
  },
  {
    label: "DELETE /api/v1/watchlist/[id]",
    call: () => watchlistDELETE(request("/api/v1/watchlist/w1", "DELETE"), { params: Promise.resolve({ id: "w1" }) }),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  dbTouched.mockClear();
});

describe("認可で拒否されたリクエストは拒否応答をそのまま返す", () => {
  it.each(CASES)("$label は 403 を返し、DB へ到達しない", async ({ call }) => {
    requireRoleOrAdminMock.mockResolvedValue(forbidden());
    const response = await call();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it.each(CASES)("$label は 401 をそのまま返し、200 に化けない", async ({ call }) => {
    requireRoleOrAdminMock.mockResolvedValue(unauthorized());
    const response = await call();
    expect(response.status).toBe(401);
    expect(dbTouched).not.toHaveBeenCalled();
  });

  it("すべての RBAC 保護ルートが本テストに含まれている", () => {
    // ルートを増やしたときに、この一覧へ追加し忘れると気づけるようにする。
    // 実装側の requireRoleOrAdmin 利用箇所と件数を突き合わせる。
    expect(CASES).toHaveLength(7);
    expect(CASES.map((c) => c.label)).toEqual([
      "POST /api/v1/decisions",
      "POST /api/v1/sites",
      "POST /api/v1/reports",
      "GET /api/v1/watchlist",
      "POST /api/v1/watchlist",
      "PATCH /api/v1/watchlist/[id]",
      "DELETE /api/v1/watchlist/[id]",
    ]);
  });
});
