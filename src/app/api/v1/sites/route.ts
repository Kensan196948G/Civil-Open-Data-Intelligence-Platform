import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";
import { requireRoleOrAdmin } from "@/lib/rbac";

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

const SITE_KINDS = new Set(["land", "marine", "both"]);

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:sites", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sites = await prisma.constructionSite.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json({
    data: { sites },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString(), sourceCount: sites.length },
  });
}

export async function POST(request: NextRequest) {
  // RBAC: engineer 以上が現場を登録できる（管理者認証は従来どおり許可）
  const authError = await requireRoleOrAdmin(request, ["engineer", "data-steward", "admin"]);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:sites:write", clientIdentifier(request), 30, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  if (!code || !name || !SITE_KINDS.has(kind) || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "code/name/kind(lan|marine|both)/lat(-90..90)/lon(-180..180) を確認してください" } },
      { status: 400 },
    );
  }

  const existing = await prisma.constructionSite.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ error: { code: "duplicate", message: `site code ${code} は既に存在します` } }, { status: 409 });
  }

  const site = await prisma.$transaction(async (tx) => {
    const row = await tx.constructionSite.create({
      data: {
        code,
        name,
        kind,
        lat,
        lon,
        jmaStationId: typeof body.jmaStationId === "string" ? body.jmaStationId : null,
        waveGridLat: body.waveGridLat === undefined ? null : Number(body.waveGridLat) || null,
        waveGridLon: body.waveGridLon === undefined ? null : Number(body.waveGridLon) || null,
        address: typeof body.address === "string" ? body.address : null,
        note: typeof body.note === "string" ? body.note : null,
      },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({ action: "現場登録", target: code, detail: `現場「${name}」を登録 (kind=${kind})` }),
    });
    return row;
  });

  return NextResponse.json({ data: { site } }, { status: 201 });
}
