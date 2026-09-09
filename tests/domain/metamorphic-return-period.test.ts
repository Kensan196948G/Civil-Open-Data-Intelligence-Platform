import { describe, expect, it } from "vitest";
import { returnPeriods } from "@/lib/analysis/return-period";

/**
 * Metamorphic Test (Gate 2) — 再現期間推算の不変条件。
 *
 * 再現期間の「正しい値」を独立に作るのは難しいため、入力変換に対する
 * 数学的不変条件で実装の正しさを検証する (docs/quality/TOLERANCE_SPEC.md 2.4):
 *
 *   MR-RP-1  全年度最大値を c 倍 → 量子位も c 倍 (スケール不変、Gumbel/Weibull 共通)
 *   MR-RP-2  全値に t 加算 → Gumbel 量子位も t 加算 (平行移動不変、Gumbel のみ)
 *   MR-RP-3  再現期間 T2>T1 で量子位は単調非減少
 *   MR-RP-4  データ不足・不正 T は例外で拒否 (誤った値を返さない)
 */

const ANNUAL_MAXIMA = [48, 55, 62, 58, 71, 66, 83, 90, 77, 102];
const REL_TOL = 1e-9;

function assertClose(actual: number, expected: number, relTol = REL_TOL) {
  const scale = Math.max(Math.abs(expected), 1e-12);
  expect(Math.abs(actual - expected) / scale).toBeLessThan(relTol);
}

describe("metamorphic return-period invariants", () => {
  for (const method of ["gumbel", "weibull"] as const) {
    it(`MR-RP-1: scaling all annual maxima by c scales quantiles by c (${method})`, () => {
      const c = 2.5;
      const base = returnPeriods(ANNUAL_MAXIMA, method);
      const scaled = returnPeriods(ANNUAL_MAXIMA.map((v) => v * c), method);
      base.forEach((b, i) => {
        expect(scaled[i].periodYears).toBe(b.periodYears);
        assertClose(scaled[i].value, b.value * c);
      });
    });

    it(`MR-RP-3: quantiles are monotonically non-decreasing in T (${method})`, () => {
      const rows = returnPeriods(ANNUAL_MAXIMA, method);
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i].value).toBeGreaterThanOrEqual(rows[i - 1].value);
      }
    });
  }

  it("MR-RP-2: shifting all values by t shifts Gumbel quantiles by t", () => {
    const t = 30;
    const base = returnPeriods(ANNUAL_MAXIMA, "gumbel");
    const shifted = returnPeriods(ANNUAL_MAXIMA.map((v) => v + t), "gumbel");
    base.forEach((b, i) => {
      assertClose(shifted[i].value, b.value + t);
    });
  });

  it("MR-RP-4: rejects invalid inputs instead of returning a plausible number", () => {
    expect(() => returnPeriods([1, 2], "gumbel")).toThrow(RangeError);
    expect(() => returnPeriods([1, 2, 3, 4], "weibull")).toThrow(RangeError);
    expect(() =>
      returnPeriods(ANNUAL_MAXIMA.map((v) => -v), "weibull"),
    ).toThrow(RangeError);
    expect(() =>
      returnPeriods(ANNUAL_MAXIMA, "gumbel", [1] as unknown as readonly number[]),
    ).toThrow(RangeError);
  });
});
