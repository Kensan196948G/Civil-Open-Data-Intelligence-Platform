/**
 * 観測値一括登録 (POST /api/v1/observations/{weather,marine}) の入力サイズ制約。
 *
 * ■ なぜ件数の上限が要るか
 *
 * GET 側は `intParam(sp, "limit", 200, 1, 2000)` で 1 リクエストが読む件数に上限が
 * あるのに、POST 側の配列長には上限が無かった。検証は「非空の配列であること」だけで、
 * その後 1 要素ずつ `await prisma.*.upsert(...)` を逐次実行する。
 *
 * レート制限 (1分あたり30リクエスト) は**リクエスト数**を縛るもので、1リクエストの
 * 重さは縛らない。したがって上限が無いと、認証済みの呼び出し元が 1 回のリクエストで
 * 数万件の逐次 DB ラウンドトリップを発生させ、接続を長時間占有できてしまう。
 */
export const MAX_OBSERVATION_BATCH = 2000;

export interface ObservationBatchError {
  readonly code: "invalid_query";
  readonly message: string;
}

/**
 * 一括登録のリクエストボディを検証する。
 * 妥当なら要素の配列、そうでなければ 400 応答に載せるエラーを返す。
 */
export function validateObservationBatch(
  body: unknown,
): { ok: true; rows: unknown[] } | { ok: false; error: ObservationBatchError } {
  if (!Array.isArray(body) || body.length === 0) {
    return {
      ok: false,
      error: { code: "invalid_query", message: "観測値の配列を指定してください" },
    };
  }
  if (body.length > MAX_OBSERVATION_BATCH) {
    return {
      ok: false,
      error: {
        code: "invalid_query",
        message: `観測値は1リクエストあたり${MAX_OBSERVATION_BATCH}件までです（指定: ${body.length}件）`,
      },
    };
  }
  return { ok: true, rows: body };
}
