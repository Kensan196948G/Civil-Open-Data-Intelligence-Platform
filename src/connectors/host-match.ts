/**
 * コネクタ振り分け用のホスト判定ヘルパー。
 *
 * 文字列包含 (`url.includes` によるドメイン名の部分一致) でホストを判定してはならない。
 * クエリ・パス・フラグメントに現れただけの `https://evil.example/?x=example.go.jp` や、
 * より長い登録可能ドメインの一部である `https://example.go.jp.evil.example/` を
 * 通してしまう (CodeQL js/incomplete-url-substring-sanitization)。
 *
 * 判定は必ず URL をパースした `hostname` に対して行い、
 * **完全一致 または `"." + domain` で終わる** の二択で書く。
 * ドット無しのサフィックス比較 (`endsWith(domain)`) は `evilexample.go.jp` を通す。
 */

/**
 * HTTPS の絶対URLとしてパースできた場合のみ `URL` を返す。
 *
 * HTTPS 必須は estat (`isAllowedEstatUrl`) / gsi (`isGsiElevationEndpoint`) の
 * 既存判定に揃えた。`prisma/seed-data.ts` の登録値は全件 HTTPS のため、
 * 現行の振り分け結果は変わらない。
 */
function parseHttpsUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** hostname が domain と完全一致するか、その真のサブドメインか */
function matchesAnyHost(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * hostname が `domains` のいずれかと完全一致するか、そのサブドメインか。
 *
 * サブドメインを許可するのは、台帳の登録値が apex ではなくサブドメイン配信
 * (`www.xroad.mlit.go.jp` / `api.jartic-open-traffic.org` / `www.data.jma.go.jp`) だから。
 * 拒否すると実在データソースの振り分けが壊れる。
 *
 * `domains` には**登録可能ドメインではなく、担当したい範囲そのもの**を渡すこと。
 * 例: 気象庁XMLは `data.jma.go.jp` を渡す。`jma.go.jp` へ広げると
 * `www.jma.go.jp/bosai/**` のJSON配信まで巻き込み、XML前提の検証で一斉に失敗する。
 */
export function hostMatches(value: string | null | undefined, domains: readonly string[]): boolean {
  const url = parseHttpsUrl(value);
  return url !== null && matchesAnyHost(url.hostname, domains);
}

/**
 * `hostMatches` に加えて、パスが `pathPrefix` 配下であることも要求する。
 *
 * ホスト単位では広すぎる場合に使う。PLATEAU は `www.mlit.go.jp/plateau/` を担当するが、
 * `mlit.go.jp` をホスト一致で受けると同省庁の別サービス
 * (`www.xroad.mlit.go.jp` / `www.netis.mlit.go.jp` / `road-structures-db.mlit.go.jp`) まで
 * 横取りしてしまう。registry では plateau が xroad より前にいるため実害が出る。
 */
export function hostPathMatches(
  value: string | null | undefined,
  domains: readonly string[],
  pathPrefix: string,
): boolean {
  const url = parseHttpsUrl(value);
  if (!url || !matchesAnyHost(url.hostname, domains)) return false;
  return url.pathname === pathPrefix || url.pathname.startsWith(`${pathPrefix}/`);
}
