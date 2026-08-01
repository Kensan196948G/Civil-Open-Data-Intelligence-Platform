import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawMock = vi.hoisted(() => vi.fn());
const isPostgreSqlRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

vi.mock("@/lib/database-url", () => ({
  isPostgreSqlRuntime: isPostgreSqlRuntimeMock,
}));

import { resetStandardRecordsAvailabilityForTests, standardRecordsAvailable } from "@/lib/standard-records";

beforeEach(() => {
  isPostgreSqlRuntimeMock.mockReturnValue(true);
  resetStandardRecordsAvailabilityForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("standardRecordsAvailable", () => {
  it("PostgreSQLでなければクエリせずfalseを返す", async () => {
    isPostgreSqlRuntimeMock.mockReturnValue(false);

    await expect(standardRecordsAvailable()).resolves.toBe(false);
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("Workers/Hyperdrive runtimeではDATABASE_URLなしでも標準レコードを確認する", async () => {
    isPostgreSqlRuntimeMock.mockReturnValue(true);
    queryRawMock.mockResolvedValueOnce([{ count: 1 }]);

    await expect(standardRecordsAvailable()).resolves.toBe(true);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("空結果(false)はキャッシュせず、再呼び出しのたびに再評価する", async () => {
    queryRawMock.mockResolvedValue([{ count: 0 }]);

    await expect(standardRecordsAvailable()).resolves.toBe(false);
    await expect(standardRecordsAvailable()).resolves.toBe(false);

    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });

  it("true になった結果はキャッシュし、以降クエリしない", async () => {
    queryRawMock.mockResolvedValueOnce([{ count: 1 }]);

    await expect(standardRecordsAvailable()).resolves.toBe(true);
    await expect(standardRecordsAvailable()).resolves.toBe(true);
    await expect(standardRecordsAvailable()).resolves.toBe(true);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("true になった結果はTTL後に再評価する", async () => {
    vi.useFakeTimers();
    try {
      queryRawMock.mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([{ count: 0 }]);

      await expect(standardRecordsAvailable()).resolves.toBe(true);
      vi.advanceTimersByTime(60_001);
      await expect(standardRecordsAvailable()).resolves.toBe(false);

      expect(queryRawMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("並行呼び出しはsingle-flightで1回だけ評価する", async () => {
    let resolveQuery: (value: { count: number }[]) => void = () => {};
    queryRawMock.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );

    const first = standardRecordsAvailable();
    const second = standardRecordsAvailable();
    resolveQuery([{ count: 1 }]);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("false→true に遷移した場合、直後の呼び出しから true を返す", async () => {
    queryRawMock.mockResolvedValueOnce([{ count: 0 }]);
    await expect(standardRecordsAvailable()).resolves.toBe(false);

    queryRawMock.mockResolvedValueOnce([{ count: 3 }]);
    await expect(standardRecordsAvailable()).resolves.toBe(true);

    expect(queryRawMock).toHaveBeenCalledTimes(2);
  });
});
