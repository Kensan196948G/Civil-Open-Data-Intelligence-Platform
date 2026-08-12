import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TtlCache } from "@/lib/ttl-cache";
import { requireAdminRequest } from "@/lib/admin-auth";

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
const roleCache = new TtlCache<string>(ROLE_CACHE_MAX_ENTRIES, ROLE_CACHE_TTL_MS);

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Cloudflare Access / proxy 認証済みユーザーの識別ヘッダーからメールを取得する。 */
export function userEmailFromRequest(request: NextRequest): string | null {
  const email =
    request.headers.get("x-codip-user") ??
    request.headers.get("cf-access-authenticated-user-email");
  return email ? normalizeEmail(email) : null;
}

export type RoleResolver = (userEmail: string, scope?: string, now?: Date) => Promise<string>;

export function createRoleResolver(
  deps: {
    findMany?: typeof prisma.roleAssignment.findMany;
    cache?: Pick<TtlCache<string>, "get" | "set">;
  } = {},
): RoleResolver {
  const findMany = deps.findMany ?? prisma.roleAssignment.findMany;
  const cache = deps.cache ?? roleCache;

  return async (userEmail, scope = "global", now = new Date()) => {
    const email = normalizeEmail(userEmail);
    const key = `${scope}:${email}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let roleName = DEFAULT_ROLE;
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
      if (best) roleName = best.role.name;
    } catch (error) {
      // 解決失敗は昇格を拒否（viewer へフォールバック）。fail-closed。
      console.error("[rbac] role resolution failed; falling back to viewer", error);
    }
    cache.set(key, roleName);
    return roleName;
  };
}

export const resolveUserRole = createRoleResolver();

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
    return errorResponse(401, "unauthorized", "認証済みユーザー識別ヘッダーがありません");
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
