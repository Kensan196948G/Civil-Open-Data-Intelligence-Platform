import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.hoisted(() => vi.fn());
const isPostgreSqlDatabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

vi.mock("@/lib/database-url", () => ({
  isPostgreSqlDatabase: isPostgreSqlDatabaseMock,
}));

import { resetStandardRecordsAvailabilityForTests, standardRecordsAvailable } from "@/lib/standard-records";

beforeEach(() => {
  isPostgreSqlDatabaseMock.mockReturnValue(true);
  resetStandardRecordsAvailabilityForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("standardRecordsAvailable", () => {
  it("PostgreSQLでなければクエリせずfalseを返す", async () => {
    isPostgreSqlDatabaseMock.mockReturnValue(false);

    await expect(standardRecordsAvailable()).resolves.toBe(false);
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("空結果(false)はキャッシュせず、再呼び出しのたびに再評価する", async () => {
    queryRawMock.mockResolvedValue([{ count: 0 }]);

    await expect(standardRecordsAvailable()).resolves.toBe(false);
    await expect(standardRecordsAvailable()).resolves.toBe(false);

    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it("true になった結果は TTL 内キャッシュし、以降クエリしない", async () => {
    queryRawMock.mockResolvedValueOnce([{ count: 1 }]);

    await expect(standardRecordsAvailable()).resolves.toBe(true);
    await expect(standardRecordsAvailable()).resolves.toBe(true);
    await expect(standardRecordsAvailable()).resolves.toBe(true);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("Issue #25: TTL 経過後は再評価し、空化していれば false へ戻る", async () => {
    vi.useFakeTimers();
    try {
      queryRawMock.mockResolvedValueOnce([{ count: 1 }]);
      await expect(standardRecordsAvailable()).resolves.toBe(true);

      // TTL (60s) 内は再クエリしない
      vi.advanceTimersByTime(59_000);
      await expect(standardRecordsAvailable()).resolves.toBe(true);
      expect(queryRawMock).toHaveBeenCalledTimes(1);

      // TTL 経過後: 運用ロールバックでテーブルが空になったケース
      vi.advanceTimersByTime(2_000);
      queryRawMock.mockResolvedValueOnce([{ count: 0 }]);
      await expect(standardRecordsAvailable()).resolves.toBe(false);
      expect(queryRawMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("false→true に遷移した場合、直後の呼び出しから true を返す", async () => {
    queryRawMock.mockResolvedValueOnce([{ count: 0 }]);
    await expect(standardRecordsAvailable()).resolves.toBe(false);

    queryRawMock.mockResolvedValueOnce([{ count: 3 }]);
    await expect(standardRecordsAvailable()).resolves.toBe(true);

    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it("並行呼び出しは 1 回の評価を共有する (single-flight)", async () => {
    let resolveQuery: (rows: { count: number }[]) => void = () => {};
    queryRawMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveQuery = resolve; }),
    );

    const p1 = standardRecordsAvailable();
    const p2 = standardRecordsAvailable();
    resolveQuery([{ count: 2 }]);

    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });
});

