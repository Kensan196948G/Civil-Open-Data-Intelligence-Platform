/**
 * Cloudflare Access 認証済みリクエストへ proxy secret を注入するミドルウェア用ロジック。
 *
 * Cloudflare Access の self-hosted アプリには汎用ヘッダー注入が無いため、
 * Worker 側ミドルウェアで「Access が認証済みユーザー識別ヘッダー
 * (cf-access-authenticated-user-email) を付与したリクエスト」にだけ
 * x-codip-proxy-secret を付与する。オリジンは Access の背後にのみ存在するため、
 * このヘッダーを外部から偽装して到達することはできない (docs/09 §2.1 の前提)。
 */

export const ACCESS_USER_EMAIL_HEADER = "cf-access-authenticated-user-email";
export const PROXY_SECRET_HEADER = "x-codip-proxy-secret";

export function proxyAuthInjectionEnabled(env: Record<string, string | undefined>): boolean {
  return env.CODIP_TRUST_PROXY_AUTH === "true" && Boolean(env.CODIP_TRUST_PROXY_SECRET?.trim());
}

export function hasAccessUserIdentity(headers: Headers): boolean {
  return Boolean(headers.get(ACCESS_USER_EMAIL_HEADER)?.trim());
}

/**
 * 注入が必要な場合のみ新しい Headers を返す。不要・無効な場合は null。
 * 既存の x-codip-proxy-secret は上書きしない (fail-safe)。
 */
export function buildInjectedHeaders(
  env: Record<string, string | undefined>,
  incoming: Headers,
): Headers | null {
  if (!proxyAuthInjectionEnabled(env)) return null;
  if (!hasAccessUserIdentity(incoming)) return null;
  if (incoming.has(PROXY_SECRET_HEADER)) return null;
  const headers = new Headers(incoming);
  headers.set(PROXY_SECRET_HEADER, String(env.CODIP_TRUST_PROXY_SECRET));
  return headers;
}
