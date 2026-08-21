/**
 * クエリパラメータの共通パーサ。
 *
 * 不正値は「握りつぶして既定値へ倒す」のではなく null を返し、呼び出し側で 400 を返す。
 * 数値のクランプ（Math.min/Math.max）は NaN を素通しするため、クランプだけでは
 * 検証にならない点に注意する。
 *
 *   Math.min(Math.max(Number("abc"), 1), 2000) === NaN
 *
 * この NaN が Prisma の `take:` や `lte:` へ到達すると、未認証の GET だけで
 * 未捕捉の 500 を誘発できてしまう。
 */

/** 整数パラメータ。未指定なら fallback、範囲外・非整数・NaN なら null。 */
export function intParam(
  sp: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | null {
  const raw = sp.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** 日時パラメータ。未指定なら fallback、パースできなければ null。 */
export function dateParam(sp: URLSearchParams, name: string, fallback: Date): Date | null {
  const raw = sp.get(name);
  if (raw === null || raw === "") return fallback;
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** 非負の cursor（オフセット）。上限は深い OFFSET による全表走査を避けるため。 */
export function cursorParam(sp: URLSearchParams, max = 100_000): number | null {
  const raw = sp.get("cursor");
  if (raw === null || raw === "") return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}
