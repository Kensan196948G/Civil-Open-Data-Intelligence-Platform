import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TtlCache } from "@/lib/ttl-cache";
import { ACCESS_USER_EMAIL_HEADER } from "@/lib/proxy-auth-inject";
import {
  requireAdminRequest,
  safeTokenEqual,
  sameOriginRequest,
  unsafeMethod,
} from "@/lib/admin-auth";

/**
 * RBAC（docs/design/rbac-design.md の Phase 1 実装）。
 *
 * - 正本は RoleAssignment テーブル。未解決・解決失敗は既定ロール viewer として
 *   扱う（昇格は fail-closed、閲覧は fail-open 相当）。
 * - ロール解決は 60 秒 TTL のプロセス内キャッシュ（src/lib/ttl-cache.ts）。
 * - 変更系ルートは requireRoleOrAdmin() で「既存管理者認証 または ロール許可」を
 *   要求する。既存の管理トークン / proxy 認証経路との後方互換を保つ。
 */

export const ROLE_PRIORITY: Record<string, number> = {
  viewer: 10,
  "api-consumer": 15,
  engineer: 20,
  "data-steward": 30,
  auditor: 35,
  admin: 40,
};

export const ROLE_NAMES: readonly string[] = [
  "viewer",
  "engineer",
  "data-steward",
  "admin",
  "auditor",
  "api-consumer",
];

export const DEFAULT_ROLE = "viewer";

const ROLE_CACHE_TTL_MS = 60_000;
const ROLE_CACHE_MAX_ENTRIES = 1000;
type CachedRole = { role: string; expiresAt: number };
const roleCache = new TtlCache<CachedRole>(ROLE_CACHE_MAX_ENTRIES, ROLE_CACHE_TTL_MS);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * proxy 認証の信頼境界を検証する。ミドルウェアが注入した x-codip-proxy-secret が
 * 設定済みシークレットと一致する場合のみ、Cloudflare Access の識別ヘッダーを
 * RBAC 主体として採用する（admin-auth.ts の proxy 検証と同一方式）。
 */
export function proxyIdentityTrusted(request: NextRequest): boolean {
  if ((process.env.CODIP_TRUST_PROXY_AUTH ?? "").trim().toLowerCase() !== "true") return false;
  const configured = process.env.CODIP_TRUST_PROXY_SECRET?.trim();
  if (!configured || configured.length < 16) return false;
  const presented = request.headers.get("x-codip-proxy-secret");
  return Boolean(presented && safeTokenEqual(presented, configured));
}

/**
 * Cloudflare Access / proxy 認証済みユーザーの識別ヘッダーからメールを取得する。
 *
 * 主体は Access が付与する cf-access-authenticated-user-email のみを採用する。
 * かつて併用していた x-codip-user は「リクエスト送信者が自由に設定できる値」で
 * あり、Access を通過した任意の利用者が管理者のメールアドレスを名乗って
 * ロール解決を通せる権限昇格経路になっていた（本番コード側にこのヘッダーを
 * 付与する箇所は存在せず、テストの便宜以外の用途が無かった）。
 * 送信されてきた x-codip-user は middleware 側で除去する
 * （src/lib/proxy-auth-inject.ts）。
 */
export function userEmailFromRequest(request: NextRequest): string | null {
  if (!proxyIdentityTrusted(request)) return null;
  const email = request.headers.get(ACCESS_USER_EMAIL_HEADER);
  return email ? normalizeEmail(email) : null;
}

export type RoleResolver = (userEmail: string, scope?: string, now?: Date) => Promise<string>;

export function createRoleResolver(
  deps: {
    findMany?: typeof prisma.roleAssignment.findMany;
    cache?: Pick<TtlCache<CachedRole>, "get" | "set" | "delete">;
  } = {},
): RoleResolver {
  const findMany = deps.findMany ?? prisma.roleAssignment.findMany;
  const cache = deps.cache ?? roleCache;

  return async (userEmail, scope = "global", now = new Date()) => {
    const email = normalizeEmail(userEmail);
    const key = `${scope}:${email}`;
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > now.getTime()) return cached.role;
    if (cached !== undefined) cache.delete(key);

    let roleName = DEFAULT_ROLE;
    let assignmentExpiresAt: Date | null = null;
    try {
      const rows = await findMany({
        where: {
          userEmail: email,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          scope: { in: [scope, "global"] },
        },
        include: { role: { select: { name: true, priority: true } } },
      });
      // DBフィルタと独立にJS側でも失効・期限切れを除外する（防御的2重チェック）。
      const activeRows = rows.filter(
        (r) => r.revokedAt === null && (r.expiresAt === null || r.expiresAt > now),
      );
      // 該当スコープ割当を優先し、無ければ global 割当。同じスコープ内では
      // priority が最も高いロールを採用する。
      const scoped = activeRows.filter((row) => row.scope === scope);
      const pool =
        scoped.length > 0 ? scoped : activeRows.filter((row) => row.scope === "global");
      const best = pool.sort(
        (a, b) => (ROLE_PRIORITY[b.role.name] ?? 0) - (ROLE_PRIORITY[a.role.name] ?? 0),
      )[0];
      if (best) {
        roleName = best.role.name;
        assignmentExpiresAt = best.expiresAt;
      }
    } catch (error) {
      // 解決失敗は昇格を拒否（viewer へフォールバック）。fail-closed。
      console.error("[rbac] role resolution failed; falling back to viewer", error);
    }
    // 割当自体の期限が TTL より先に来る場合は、その期限をキャッシュの有効期限にする。
    const cacheExpiresAt = assignmentExpiresAt
      ? Math.min(now.getTime() + ROLE_CACHE_TTL_MS, assignmentExpiresAt.getTime())
      : now.getTime() + ROLE_CACHE_TTL_MS;
    cache.set(key, { role: roleName, expiresAt: cacheExpiresAt });
    return roleName;
  };
}

export const resolveUserRole = createRoleResolver();

/** 割当の作成・失効時に、対象ユーザーのキャッシュを無効化する。 */
export function invalidateRoleCache(userEmail: string, scope = "global"): void {
  roleCache.delete(`${scope}:${normalizeEmail(userEmail)}`);
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * ロール単独のガード。管理者トークン経由の上書きはしない（requireRoleOrAdmin と併用）。
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: readonly string[],
  resolver: RoleResolver = resolveUserRole,
  scope = "global",
): Promise<NextResponse | null> {
  const email = userEmailFromRequest(request);
  if (!email) {
    return errorResponse(
      401,
      "unauthorized",
      "管理認証が必要です（認証済みユーザー識別ヘッダーがありません）",
    );
  }
  // proxy 認証は Cloudflare Access の Cookie に依存するため、ブラウザは
  // クロスサイトのフォーム送信でも識別ヘッダー付きのリクエストを送出できる。
  // requireAdminRequest() と同じ同一Origin検証をロール単独経路にも課す。
  if (unsafeMethod(request.method) && !sameOriginRequest(request)) {
    return errorResponse(
      403,
      "csrf_check_failed",
      "proxy 認証を使う変更操作は同一Originからのみ実行できます",
    );
  }
  const role = await resolver(email, scope);
  if (!allowedRoles.includes(role)) {
    return errorResponse(
      403,
      "forbidden",
      `必要なロール（${allowedRoles.join(" / ")}）がありません（現在: ${role}）`,
    );
  }
  return null;
}

/**
 * 変更系ルート用ガード。既存の管理者認証（トークン / proxy / セッション）が
 * 通っていれば許可し、それ以外はロールで判定する。後方互換を保つため、
 * ロール未導入環境でも管理者は従来どおり操作できる。
 */
export async function requireRoleOrAdmin(
  request: NextRequest,
  allowedRoles: readonly string[],
  resolver: RoleResolver = resolveUserRole,
): Promise<NextResponse | null> {
  const adminError = requireAdminRequest(request);
  if (!adminError) return null;
  return requireRole(request, allowedRoles, resolver);
}
