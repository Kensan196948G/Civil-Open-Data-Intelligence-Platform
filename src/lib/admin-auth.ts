import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ADMIN_TOKEN_HEADER = "x-codip-admin-token";
const MIN_ADMIN_SECRET_LENGTH = 32;
export const ADMIN_SESSION_COOKIE = "codip_admin_session";
export const ADMIN_SESSION_COOKIE_SECURE = "__Host-codip_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type AdminAuthSource = "local" | "proxy" | "token" | "session" | null;

type HeaderReader = {
  get(name: string): string | null;
};

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function safeTokenEqual(a: string, b: string): boolean {
  return safeEqual(a, b);
}

function csvValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function rawCsvValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Issue #24 / Codex adversarial P2: CODIP_DISABLE_TOKEN_AUTH の正規化パース。
 * 大文字・空白の揺れ (TRUE / " true ") で「無効化したつもりが有効のまま」という
 * fail-open を避ける。不正値の fail-fast は validate-env.js が担う。
 */
export function isTokenAuthDisabled(): boolean {
  return (process.env.CODIP_DISABLE_TOKEN_AUTH ?? "").trim().toLowerCase() === "true";
}

function bearerToken(headers: HeaderReader): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function cookieValue(headers: HeaderReader, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function sessionCookieValue(headers: HeaderReader): string | null {
  return (
    cookieValue(headers, ADMIN_SESSION_COOKIE_SECURE) ?? cookieValue(headers, ADMIN_SESSION_COOKIE)
  );
}

export function adminSessionValue(configuredToken: string): string {
  return createAdminSessionCookieValue(configuredToken);
}

function signSessionPayload(configuredToken: string, payload: string): string {
  return createHmac("sha256", configuredToken).update(payload).digest("hex");
}

export function createAdminSessionCookieValue(
  configuredToken: string,
  now = Date.now(),
  nonce = randomUUID(),
): string {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + ADMIN_SESSION_MAX_AGE_SECONDS;
  const payload = `v2.${issuedAt}.${expiresAt}.${nonce}`;
  return `${payload}.${signSessionPayload(configuredToken, payload)}`;
}

function statelessSessionCookieMatches(
  value: string,
  configuredToken: string,
  now = Date.now(),
): boolean {
  const parts = value.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return false;

  const [version, issuedAtValue, expiresAtValue, nonce, signature] = parts;
  const issuedAt = Number(issuedAtValue);
  const expiresAt = Number(expiresAtValue);
  if (
    version !== "v2" ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > ADMIN_SESSION_MAX_AGE_SECONDS ||
    Math.floor(now / 1000) > expiresAt ||
    nonce.length < 16
  ) {
    return false;
  }

  const payload = `${version}.${issuedAtValue}.${expiresAtValue}.${nonce}`;
  return safeEqual(signature, signSessionPayload(configuredToken, payload));
}

function sessionCookieMatches(headers: HeaderReader, configuredToken: string): boolean {
  const value = sessionCookieValue(headers);
  return Boolean(value && statelessSessionCookieMatches(value, configuredToken));
}

function requestOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (origin) return origin;

  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function trustProxyHeaders(): boolean {
  return process.env.CODIP_TRUST_PROXY_HEADERS === "true";
}

export function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = trustProxyHeaders()
    ? firstHeaderValue(request.headers.get("x-forwarded-proto"))
    : null;
  if (forwardedProto === "https" || request.nextUrl.protocol === "https:") return true;
  return (
    process.env.NODE_ENV === "production" &&
    process.env.CODIP_ALLOW_INSECURE_LOCAL_COOKIES !== "true"
  );
}

export function adminSessionCookieName(request: NextRequest): string {
  return isSecureRequest(request) ? ADMIN_SESSION_COOKIE_SECURE : ADMIN_SESSION_COOKIE;
}

export function hasAdminSessionCookie(request: NextRequest): boolean {
  return Boolean(
    request.cookies.get(ADMIN_SESSION_COOKIE_SECURE)?.value ??
      request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );
}

function requestUrlOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>();
  const nextOrigin = normalizedOrigin(request.nextUrl.origin);
  if (nextOrigin) origins.add(nextOrigin);

  const host = firstHeaderValue(
    (trustProxyHeaders() ? request.headers.get("x-forwarded-host") : null) ??
      request.headers.get("host"),
  );
  if (host) {
    const proto =
      (trustProxyHeaders() ? firstHeaderValue(request.headers.get("x-forwarded-proto")) : null) ??
      request.nextUrl.protocol.replace(":", "");
    const headerOrigin = normalizedOrigin(`${proto}://${host}`);
    if (headerOrigin) origins.add(headerOrigin);
  }

  return origins;
}

function allowedOrigins(): Set<string> {
  const values = rawCsvValues(process.env.CODIP_ALLOWED_ORIGINS);
  return new Set(
    values
      .map((value) => normalizedOrigin(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function sameOriginRequest(request: NextRequest): boolean {
  const origin = requestOrigin(request);
  if (!origin) return false;

  const normalizedRequestOrigin = normalizedOrigin(origin);
  if (!normalizedRequestOrigin) return false;

  return (
    requestUrlOrigins(request).has(normalizedRequestOrigin) ||
    allowedOrigins().has(normalizedRequestOrigin)
  );
}

function unsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function strictRuntimeMode(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CODIP_ENV_MODE === "preview" ||
    process.env.CODIP_ENV_MODE === "production"
  );
}

function allowInsecureLocalAdmin(): boolean {
  return (
    !strictRuntimeMode() &&
    process.env.CODIP_ALLOW_INSECURE_ADMIN === "true"
  );
}

export function adminSecretUsable(value: string | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return !strictRuntimeMode() || trimmed.length >= MIN_ADMIN_SECRET_LENGTH;
}

function configuredAdminToken(): string | null {
  const token = process.env.CODIP_ADMIN_TOKEN?.trim();
  return adminSecretUsable(token) ? token : null;
}

function proxyGuardConfigured(): boolean {
  return (
    process.env.CODIP_TRUST_PROXY_AUTH === "true" &&
    adminSecretUsable(process.env.CODIP_TRUST_PROXY_SECRET) &&
    (csvValues(process.env.CODIP_ADMIN_EMAILS).length > 0 ||
      csvValues(process.env.CODIP_ADMIN_EMAIL_DOMAINS).length > 0)
  );
}

function proxyEmailAllowed(email: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = csvValues(process.env.CODIP_ADMIN_EMAILS);
  const allowedDomains = csvValues(process.env.CODIP_ADMIN_EMAIL_DOMAINS).map((domain) =>
    domain.startsWith("@") ? domain.slice(1) : domain,
  );
  const domain = normalizedEmail.split("@")[1] ?? "";
  return allowedEmails.includes(normalizedEmail) || allowedDomains.includes(domain);
}

export function isAdminHeaders(headers: HeaderReader): boolean {
  return adminAuthSource(headers) !== null;
}

function adminAuthSource(headers: HeaderReader): AdminAuthSource {
  if (allowInsecureLocalAdmin()) return "local";

  if (process.env.CODIP_TRUST_PROXY_AUTH === "true") {
    const cloudflareUser = headers.get("cf-access-authenticated-user-email");
    const proxySecret = adminSecretUsable(process.env.CODIP_TRUST_PROXY_SECRET)
      ? process.env.CODIP_TRUST_PROXY_SECRET?.trim()
      : null;
    const requestProxySecret = headers.get("x-codip-proxy-secret");
    if (
      cloudflareUser &&
      proxySecret &&
      requestProxySecret &&
      safeEqual(requestProxySecret, proxySecret) &&
      proxyEmailAllowed(cloudflareUser)
    ) {
      return "proxy";
    }
  }

  const configuredToken = configuredAdminToken();
  if (configuredToken) {
    // Issue #24 (Codex adversarial P2): proxy auth (Cloudflare Access) を主境界とする
    // 本番では、token ヘッダー経路を明示フラグで無効化できる。token が漏洩しても
    // proxy を経由しない直接アクセスで管理操作できなくなる。既定は後方互換 (有効)。
    // session (ブラウザ Cookie) 経路はトークン値を送らないため無効化対象外
    if (!isTokenAuthDisabled()) {
      const requestToken = headers.get(ADMIN_TOKEN_HEADER) ?? bearerToken(headers);
      if (requestToken && safeEqual(requestToken, configuredToken)) return "token";
    }
    if (sessionCookieMatches(headers, configuredToken)) return "session";
  }

  return null;
}

function adminGuardConfigured(): boolean {
  return Boolean(configuredAdminToken()) || proxyGuardConfigured();
}

export function requireAdminRequest(request: NextRequest): NextResponse | null {
  const source = adminAuthSource(request.headers);
  if (source) {
    if (
      (source === "session" || source === "proxy") &&
      unsafeMethod(request.method) &&
      !sameOriginRequest(request)
    ) {
      return NextResponse.json(
        {
          error: "csrf_check_failed",
          message: "管理セッションCookieを使う変更操作は同一Originからのみ実行できます",
        },
        { status: 403 },
      );
    }
    return null;
  }

  if (!adminGuardConfigured() && !allowInsecureLocalAdmin()) {
    return NextResponse.json(
      {
        error: "admin_guard_not_configured",
        message:
          "管理操作には CODIP_ADMIN_TOKEN、または CODIP_TRUST_PROXY_AUTH / CODIP_TRUST_PROXY_SECRET / CODIP_ADMIN_EMAILS の設定が必要です",
      },
      { status: 503 },
    );
  }

  if (!isAdminHeaders(request.headers)) {
    return NextResponse.json(
      { error: "unauthorized", message: "管理操作の認証に失敗しました" },
      { status: 401 },
    );
  }
  return null;
}

export function rejectCrossOriginBrowserRequest(request: NextRequest): NextResponse | null {
  const origin = requestOrigin(request);
  if (!origin || !sameOriginRequest(request)) {
    return NextResponse.json(
      {
        error: "csrf_check_failed",
        message: "管理セッション操作には同一OriginのOriginまたはRefererヘッダーが必要です",
      },
      { status: 403 },
    );
  }
  return null;
}
