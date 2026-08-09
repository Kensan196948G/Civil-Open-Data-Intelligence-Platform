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
});
