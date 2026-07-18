import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { recordAudit, type AuditEventInput } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

/**
 * クライアント側で完結する操作 (監査ログのエクスポート、APIキーの
 * ブラウザ内テスト・保存) の監査イベント記録。
 * 監査ログへの自由文注入を防ぐため、記録内容はサーバー側の
 * kind → イベント写像で固定し、クライアントからは kind と対象IDのみ受け取る。
 */
const EVENT_KINDS = {
  audit_export_csv: { action: "エクスポート", target: "監査ログ", detail: "CSV形式で出力", level: "info" },
  audit_export_html: { action: "エクスポート", target: "監査ログ", detail: "HTML形式で出力", level: "info" },
  audit_export_pdf: { action: "エクスポート", target: "監査ログ", detail: "PDF形式で出力(印刷ダイアログ)", level: "info" },
  apikey_test_ok: { action: "APIキーのテスト", target: null, detail: "形式チェックOK", level: "info" },
  apikey_test_ng: { action: "APIキーのテスト", target: null, detail: "形式チェックNG", level: "warning" },
  apikey_save: { action: "APIキー保存", target: null, detail: "ブラウザ内にのみ保存(外部送信なし)", level: "success" },
} as const satisfies Record<
  string,
  { action: string; target: string | null; detail: string; level: AuditEventInput["level"] }
>;

type EventKind = keyof typeof EVENT_KINDS;

function isEventKind(value: string): value is EventKind {
  return Object.hasOwn(EVENT_KINDS, value);
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin-audit-events", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const kind = typeof body?.kind === "string" ? body.kind : "";
  if (!isEventKind(kind)) {
    return NextResponse.json(
      { error: "validation_error", message: "不明なイベント種別です" },
      { status: 400 },
    );
  }

  const def = EVENT_KINDS[kind];
  let target: string = def.target ?? "-";
  if (def.target === null) {
    // APIキー系イベントの対象名は sourceId からサーバー側で解決する (名前の詐称防止)
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId : "";
    const source = sourceId
      ? await prisma.dataSource.findUnique({ where: { id: sourceId }, select: { name: true } })
      : null;
    target = source?.name ?? "-";
  }

  await recordAudit({ action: def.action, target, detail: def.detail, level: def.level });
  return NextResponse.json({ ok: true });
}
