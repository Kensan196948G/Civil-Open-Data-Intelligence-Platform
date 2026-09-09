import { describe, expect, it } from "vitest";
import { returnPeriods } from "@/lib/analysis/return-period";

describe("returnPeriods", () => {
  it("computes Gumbel return levels", () => {
    const values = [3.1, 3.4, 3.8, 4.2, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5];
    const periods = returnPeriods(values, "gumbel", [50]);
    expect(periods.length).toBe(1);
    expect(periods[0].periodYears).toBe(50);
    expect(periods[0].value).toBeGreaterThan(Math.max(...values));
  });

  it("requires at least 2 years of data", () => {
    expect(() => returnPeriods([1], "gumbel")).toThrow();
  });

  it("computes Weibull return levels for positive values", () => {
    const values = [1.2, 1.5, 1.9, 2.4, 3.1];
    const periods = returnPeriods(values, "weibull", [10]);
    expect(periods[0].value).toBeGreaterThan(0);
  });

  // Regression (docs/quality/TEST_EVIDENCE.md §4): 旧 Weibull 実装は
  // 回帰軸の入れ替わりと量子位式の誤りにより、T の増加に対して
  // 非単調かつ桁外れな値 (例: T=2 で 164 → T=100 で 1.4e-7) を返した。
  // 公開 API /api/v1/analysis/wave50?method=weibull の正確性に関わる不具合。
  it("weibull curve is monotonically non-decreasing and stays in a plausible range", () => {
    const values = [48, 55, 62, 58, 71, 66, 83, 90, 77, 102];
    const rows = returnPeriods(values, "weibull");
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].value).toBeGreaterThanOrEqual(rows[i - 1].value);
    }
    // 2 年再現値は標本の中央付近、100 年値は標本最大値を大きく超えない
    const sorted = [...values].sort((a, b) => a - b);
    const median = (sorted[4] + sorted[5]) / 2;
    expect(rows[0].value).toBeGreaterThan(median * 0.5);
    expect(rows[0].value).toBeLessThan(median * 2);
    expect(rows[rows.length - 1].value).toBeLessThan(Math.max(...values) * 5);
  });
});
