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

/**
 * 日時パラメータ。未指定なら fallback、解釈できなければ null。
 *
 * `new Date(raw)` の成否だけでは足りない。`2026-02-30` や非うるう年の
 * `2026-02-29` は **例外にも Invalid Date にもならず、翌月へ正規化される**
 * （実測: `2026-02-30` → `2026-03-02`）。そのまま Prisma の期間条件へ渡すと、
 * 利用者が指定したつもりのない期間を無言で検索する。
 * 日付部分が正規化で動いていないことを確認してから返す。
 */
export function dateParam(sp: URLSearchParams, name: string, fallback: Date): Date | null {
  const raw = sp.get(name);
  if (raw === null || raw === "") return fallback;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) return null;

  // ISO 8601 形式で暦日が明示されている場合のみ、正規化の有無を検算できる。
  // それ以外の形式 (RFC 2822 など) は Date のパースに委ねる。
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    const normalized =
      value.getUTCFullYear() === Number(year) &&
      value.getUTCMonth() + 1 === Number(month) &&
      value.getUTCDate() === Number(day);
    // ローカルタイムゾーン指定 (末尾に Z / +hh:mm が無い) の場合は UTC 日付が
    // ずれるため、ローカル日付でも一致を許す。
    const localMatch =
      value.getFullYear() === Number(year) &&
      value.getMonth() + 1 === Number(month) &&
      value.getDate() === Number(day);
    if (!normalized && !localMatch) return null;
  }
  return value;
}

/** 非負の cursor（オフセット）。上限は深い OFFSET による全表走査を避けるため。 */
export function cursorParam(sp: URLSearchParams, max = 100_000): number | null {
  const raw = sp.get("cursor");
  if (raw === null || raw === "") return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}
