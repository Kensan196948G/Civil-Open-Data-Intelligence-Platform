import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  ADMIN_SESSION_COOKIE_SECURE,
  adminSessionCookieName,
  adminSecretUsable,
  createAdminSessionCookieValue,
  hasAdminSessionCookie,
  isAdminHeaders,
  isSecureRequest,
  rejectCrossOriginBrowserRequest,
  safeTokenEqual,
  isTokenAuthDisabled,
} from "@/lib/admin-auth";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

function sessionCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: isSecureRequest(request),
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  };
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    authenticated: isAdminHeaders(request.headers),
    sessionCookie: hasAdminSessionCookie(request),
  });
}

export async function POST(request: NextRequest) {
  const csrfResponse = rejectCrossOriginBrowserRequest(request);
  if (csrfResponse) return csrfResponse;

  const rate = checkRateLimit("api:admin-session", clientIdentifier(request), 5, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  // Issue #24: CODIP_DISABLE_TOKEN_AUTH=true はトークン認証経路全体の無効化を意味する。
  // ヘッダー経路 (admin-auth.ts) だけ閉じてもここで Cookie を発行できると迂回になるため、
  // トークンによるセッション開始も同時に拒否する (proxy auth 経由のみが管理経路になる)
  if (isTokenAuthDisabled()) {
    return NextResponse.json(
      {
        error: "token_auth_disabled",
        message:
          "トークン認証は無効化されています (CODIP_DISABLE_TOKEN_AUTH)。認証プロキシ経由でアクセスしてください",
      },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const rawConfiguredToken = process.env.CODIP_ADMIN_TOKEN?.trim();
  const configuredToken = adminSecretUsable(rawConfiguredToken) ? rawConfiguredToken : "";

  if (!configuredToken) {
    return NextResponse.json(
      {
        error: "admin_guard_not_configured",
        message:
          "CODIP_ADMIN_TOKEN が未設定、または本番で必要な32文字以上の強度を満たしていません",
      },
      { status: 503 },
    );
  }

  if (!token || !safeTokenEqual(token, configuredToken)) {
    return NextResponse.json(
      { error: "unauthorized", message: "管理操作トークンが正しくありません" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(
    adminSessionCookieName(request),
    createAdminSessionCookieValue(configuredToken),
    sessionCookieOptions(request),
  );
  return response;
}

export async function DELETE(request: NextRequest) {
  const csrfResponse = rejectCrossOriginBrowserRequest(request);
  if (csrfResponse) return csrfResponse;

  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...sessionCookieOptions(request),
    secure: false,
    maxAge: 0,
  });
  response.cookies.set(ADMIN_SESSION_COOKIE_SECURE, "", {
    ...sessionCookieOptions(request),
    secure: true,
    maxAge: 0,
  });
  return response;
}
