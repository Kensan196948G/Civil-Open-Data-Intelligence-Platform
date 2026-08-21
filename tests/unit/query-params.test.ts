import { describe, expect, it } from "vitest";
import { cursorParam, dateParam, intParam } from "../../src/lib/query-params";

const sp = (qs: string) => new URLSearchParams(qs);

describe("intParam", () => {
  it("未指定・空文字は fallback を返す", () => {
    expect(intParam(sp(""), "limit", 200, 1, 2000)).toBe(200);
    expect(intParam(sp("limit="), "limit", 200, 1, 2000)).toBe(200);
  });

  it("範囲内の整数はそのまま返す", () => {
    expect(intParam(sp("limit=1"), "limit", 200, 1, 2000)).toBe(1);
    expect(intParam(sp("limit=2000"), "limit", 200, 1, 2000)).toBe(2000);
  });

  // 中核の回帰: Math.min(Math.max(Number(x),min),max) は NaN を素通しする。
  // クランプで書かれていた頃は take: NaN が Prisma へ到達し、未認証 GET で 500 になった。
  it("数値に解釈できない値は null（クランプでは NaN が素通しする）", () => {
    for (const raw of ["abc", "1e", "--1", "NaN", "0x", "1,2"]) {
      expect(intParam(sp(`limit=${encodeURIComponent(raw)}`), "limit", 200, 1, 2000)).toBeNull();
    }
    // 旧実装の挙動を明示的に固定しておく（この式が NaN を返すことが欠陥の本体だった）
    expect(Number.isNaN(Math.min(Math.max(Number("abc"), 1), 2000))).toBe(true);
  });

  it("範囲外・非整数・符号違反は null", () => {
    expect(intParam(sp("limit=0"), "limit", 200, 1, 2000)).toBeNull();
    expect(intParam(sp("limit=-1"), "limit", 200, 1, 2000)).toBeNull();
    expect(intParam(sp("limit=2001"), "limit", 200, 1, 2000)).toBeNull();
    expect(intParam(sp("limit=1.5"), "limit", 200, 1, 2000)).toBeNull();
    expect(intParam(sp("limit=Infinity"), "limit", 200, 1, 2000)).toBeNull();
  });
});

describe("dateParam", () => {
  const fallback = new Date("2026-08-22T00:00:00.000Z");

  it("未指定・空文字は fallback を返す", () => {
    expect(dateParam(sp(""), "t1", fallback)).toBe(fallback);
    expect(dateParam(sp("t1="), "t1", fallback)).toBe(fallback);
  });

  it("解釈可能な日時はその Date を返す", () => {
    const parsed = dateParam(sp("t1=2026-01-02T03:04:05.000Z"), "t1", fallback);
    expect(parsed?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  // 回帰: 暦として存在しない日は Invalid Date にならず翌月へ正規化される。
  // そのまま通すと、利用者が指定したつもりのない期間を無言で検索する。
  it("暦として存在しない日を拒否する（正規化を素通ししない）", () => {
    // 実測: new Date("2026-02-30") -> 2026-03-02、new Date("2026-02-29") -> 2026-03-01
    expect(dateParam(sp("t1=2026-02-30"), "t1", fallback)).toBeNull();
    expect(dateParam(sp("t1=2026-02-29"), "t1", fallback)).toBeNull();
    expect(dateParam(sp("t1=2026-04-31"), "t1", fallback)).toBeNull();
    expect(dateParam(sp("t1=2026-06-31T12:00:00Z"), "t1", fallback)).toBeNull();
  });

  it("実在する暦日は通す（うるう年を含む）", () => {
    expect(dateParam(sp("t1=2026-02-28"), "t1", fallback)?.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(dateParam(sp("t1=2024-02-29"), "t1", fallback)?.toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(dateParam(sp("t1=2026-12-31T23:59:59Z"), "t1", fallback)?.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  // 回帰: new Date("notadate") は例外を投げず Invalid Date を返すため、
  // 素通しすると lte: Invalid Date が Prisma へ到達する。
  it("解釈できない日時は null（Invalid Date を素通ししない）", () => {
    for (const raw of ["notadate", "2026-13-45", "", " "].filter((v) => v.trim() !== "")) {
      expect(dateParam(sp(`t1=${encodeURIComponent(raw)}`), "t1", fallback)).toBeNull();
    }
    expect(Number.isNaN(new Date("notadate").getTime())).toBe(true);
  });
});

describe("cursorParam", () => {
  it("未指定は 0、範囲内はその値", () => {
    expect(cursorParam(sp(""))).toBe(0);
    expect(cursorParam(sp("cursor=0"))).toBe(0);
    expect(cursorParam(sp("cursor=100000"))).toBe(100_000);
  });

  it("負・上限超過・非整数・非数値は null", () => {
    expect(cursorParam(sp("cursor=-1"))).toBeNull();
    expect(cursorParam(sp("cursor=100001"))).toBeNull();
    expect(cursorParam(sp("cursor=1.5"))).toBeNull();
    expect(cursorParam(sp("cursor=abc"))).toBeNull();
  });
});
