import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import {
  OPERATION_SETTING_DEFS,
  getOperationSettings,
  isOperationSettingKey,
  parseOperationSettingValue,
  setOperationSetting,
} from "@/lib/settings";

/** 接続確認の動作設定 (デザイン正本 settings view の4項目) の取得 */
export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:admin-settings", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  return NextResponse.json({ settings: await getOperationSettings() });
}

/**
 * 動作設定の変更。値はデザイン正本セレクトの選択肢のみ受理し、
 * 変更は監査ログへ「設定変更」イベントとして記録する。
 */
export async function PUT(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin-settings:write", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";
  if (!isOperationSettingKey(key)) {
    return NextResponse.json(
      { error: "validation_error", message: "不明な設定キーです" },
      { status: 400 },
    );
  }
  const def = OPERATION_SETTING_DEFS[key];
  const value = parseOperationSettingValue(key, body?.value);
  if (value === null) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: `${def.label}に指定できる値は ${def.options.join(" / ")} ${def.unit}のみです`,
      },
      { status: 400 },
    );
  }

  // 監査イベント (設定変更) は setOperationSetting が同一トランザクションで記録する
  await setOperationSetting(key, value);

  return NextResponse.json({ settings: await getOperationSettings() });
}
