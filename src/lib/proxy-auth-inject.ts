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

/**
 * 送信元が自由に設定できてしまうため、オリジンへ渡す前に必ず除去するヘッダー。
 *
 * - x-codip-proxy-secret: 本来は middleware だけが付与する内部ヘッダー。外から
 *   届いたものを素通しすると、シークレットが何らかの経路で漏れた場合に
 *   Cloudflare Access を迂回して管理操作へ到達できてしまう。
 * - x-codip-user: かつて RBAC の主体解決で参照していたヘッダー。現在は参照しないが、
 *   将来の再導入や別経路での参照に備えて境界で落とす（多層防御）。
 */
export const STRIPPED_REQUEST_HEADERS = [PROXY_SECRET_HEADER, "x-codip-user"] as const;

export function proxyAuthInjectionEnabled(env: Record<string, string | undefined>): boolean {
  return env.CODIP_TRUST_PROXY_AUTH === "true" && Boolean(env.CODIP_TRUST_PROXY_SECRET?.trim());
}

export function hasAccessUserIdentity(headers: Headers): boolean {
  return Boolean(headers.get(ACCESS_USER_EMAIL_HEADER)?.trim());
}

/**
 * オリジンへ渡すヘッダーを組み立てる。書き換えが不要なら null を返す。
 *
 * 手順は「まず外から届いた内部ヘッダーを除去し、その後で必要なら注入する」。
 * 以前は既存の x-codip-proxy-secret があると null を返して素通ししていたが、
 * これは fail-safe ではなく、外部が用意したヘッダーをそのままオリジンへ
 * 到達させる経路だった。注入の有無に関わらず除去を先に行う。
 */
export function buildInjectedHeaders(
  env: Record<string, string | undefined>,
  incoming: Headers,
): Headers | null {
  const hasStrippableHeader = STRIPPED_REQUEST_HEADERS.some((name) => incoming.has(name));
  const shouldInject = proxyAuthInjectionEnabled(env) && hasAccessUserIdentity(incoming);
  if (!hasStrippableHeader && !shouldInject) return null;

  const headers = new Headers(incoming);
  for (const name of STRIPPED_REQUEST_HEADERS) {
    headers.delete(name);
  }
  if (shouldInject) {
    headers.set(PROXY_SECRET_HEADER, String(env.CODIP_TRUST_PROXY_SECRET));
  }
  return headers;
}
