import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildInjectedHeaders } from "@/lib/proxy-auth-inject";

/**
 * Cloudflare Access 配下で、認証済みユーザー識別ヘッダーが付いた API リクエストへ
 * x-codip-proxy-secret を注入する。管理操作の proxy 認証 (CODIP_TRUST_PROXY_AUTH)
 * を有効にするための最小ミドルウェア (docs/design 参照)。
 */
export function middleware(request: NextRequest) {
  const headers = buildInjectedHeaders(process.env, request.headers);
  if (headers === null) {
    return NextResponse.next();
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // 管理APIのみ注入対象。ページSSR・静的アセットには不要
  matcher: ["/api/:path*"],
};
