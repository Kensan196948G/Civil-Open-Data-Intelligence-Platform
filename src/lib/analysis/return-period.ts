/**
 * 再現期間の確率波推算 (統合: wmcdss etl/common/return_period.py + api/analysis.py)。
 * Gumbel (モーメント法) / Weibull (Gringorten plotting position) に対応。
 */

function gumbelFit(values: number[]): { mu: number; beta: number } {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 5) {
    throw new RangeError("need at least 5 annual maxima for a meaningful fit");
  }
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  const beta = (Math.sqrt(6) * std) / Math.PI;
  const mu = mean - 0.5772 * beta;
  return { mu, beta };
}

function gumbelQuantile(mu: number, beta: number, periodYears: number): number {
  if (periodYears <= 1) throw new RangeError("return period T must be > 1");
  return mu - beta * Math.log(-Math.log(1 - 1 / periodYears));
}

function weibullFit(values: number[]): { k: number; lambda: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 5 || sorted.some((v) => v <= 0)) {
    throw new RangeError("Weibull needs at least 5 positive annual maxima");
  }
  // Gringorten plotting position, log-linear regression of x on y
  const ys = sorted.map((_, i) => Math.log(-Math.log(1 - (i + 1 - 0.44) / (n + 0.12))));
  const xs = sorted.map((v) => Math.log(v));
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = meanX - slope * meanY;
  return { k: 1 / slope, lambda: Math.exp(intercept) };
}

function weibullQuantile(k: number, lambda: number, periodYears: number): number {
  if (periodYears <= 1) throw new RangeError("return period T must be > 1");
  return lambda * Math.pow(-Math.log(1 - 1 / periodYears), 1 / k);
}

export const DEFAULT_RETURN_PERIODS = [2, 5, 10, 20, 50, 100];

export function returnPeriods(
  annualMaxima: number[],
  method: "gumbel" | "weibull" = "gumbel",
  periods: readonly number[] = DEFAULT_RETURN_PERIODS,
): { periodYears: number; value: number }[] {
  if (annualMaxima.length < 2) {
    throw new RangeError("at least 2 years of annual maxima are required");
  }
  if (method === "gumbel") {
    const { mu, beta } = gumbelFit(annualMaxima);
    return periods.map((T) => ({ periodYears: T, value: gumbelQuantile(mu, beta, T) }));
  }
  const { k, lambda } = weibullFit(annualMaxima);
  return periods.map((T) => ({ periodYears: T, value: weibullQuantile(k, lambda, T) }));
}
