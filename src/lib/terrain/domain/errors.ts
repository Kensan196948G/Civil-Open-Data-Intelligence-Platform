/**
 * API が返しうるアプリケーション固有のエラーコード (詳細設計仕様書 7.5)。
 * NO_COVERAGE は「データがない」ことを示すのみで、対象地点が安全であることを意味しない
 * (Unknown is not Safe 原則)。
 */
export type ErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NO_COVERAGE"
  | "CONFIG_VERSION_CONFLICT"
  | "ANALYSIS_AREA_TOO_LARGE"
  | "INSUFFICIENT_DATA"
  | "RATE_LIMITED"
  | "UPSTREAM_INVALID_RESPONSE"
  | "UPSTREAM_UNAVAILABLE"
  | "INTERNAL_ERROR";

export const ERROR_STATUS_MAP: Readonly<Record<ErrorCode, number>> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NO_COVERAGE: 404,
  CONFIG_VERSION_CONFLICT: 409,
  ANALYSIS_AREA_TOO_LARGE: 413,
  INSUFFICIENT_DATA: 422,
  RATE_LIMITED: 429,
  UPSTREAM_INVALID_RESPONSE: 502,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * RFC 9457 (Problem Details for HTTP APIs) 準拠のエラー応答本体。
 * `code` はアプリケーション固有の拡張フィールド。
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
}

interface ProblemDetailsOptions {
  readonly detail?: string;
  readonly instance?: string;
  readonly requestId?: string;
}

/**
 * exactOptionalPropertyTypes 下では `{ detail: undefined }` は
 * 「detailキーは存在するが値がない」と「detailキー自体がない」を区別してしまうため、
 * 未指定のフィールドはオブジェクトに含めないことで意図通りの Optional を維持する。
 */
export function createProblemDetails(
  code: ErrorCode,
  title: string,
  options: ProblemDetailsOptions = {},
): ProblemDetails {
  return {
    type: "about:blank",
    title,
    status: ERROR_STATUS_MAP[code],
    code,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    ...(options.instance !== undefined ? { instance: options.instance } : {}),
    ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
  };
}
