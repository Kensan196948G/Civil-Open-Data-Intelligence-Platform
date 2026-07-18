import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appSettingFindManyMock = vi.hoisted(() => vi.fn());
const appSettingUpsertMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());
const dataSourceFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: {
      findMany: appSettingFindManyMock,
      upsert: appSettingUpsertMock,
    },
    auditLog: {
      create: auditLogCreateMock,
    },
    dataSource: {
      findUnique: dataSourceFindUniqueMock,
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/admin/settings/route";
import { POST as auditEventsPOST } from "@/app/api/admin/audit-events/route";
import { invalidateOperationSettingsCache } from "@/lib/settings";
import { resetRateLimitForTests } from "@/lib/rate-limit";

function settingsRequest(method: string, body?: unknown) {
  return new NextRequest("http://127.0.0.1:3100/api/admin/settings", {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3100" },
  });
}

function auditEventRequest(body: unknown) {
  return new NextRequest("http://127.0.0.1:3100/api/admin/audit-events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3100" },
  });
}

describe("admin settings / audit-events routes", () => {
  beforeEach(() => {
    resetRateLimitForTests();
    invalidateOperationSettingsCache();
    appSettingFindManyMock.mockReset().mockResolvedValue([]);
    appSettingUpsertMock.mockReset().mockResolvedValue({});
    auditLogCreateMock.mockReset().mockResolvedValue({});
    dataSourceFindUniqueMock.mockReset().mockResolvedValue(null);
    // ローカル開発相当の管理許可 (strict mode ではないので有効)
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimitForTests();
  });

  it("returns current operation settings", async () => {
    appSettingFindManyMock.mockResolvedValueOnce([{ key: "timeoutSec", value: "60" }]);
    const response = await settingsGET(settingsRequest("GET"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.settings.timeoutSec).toBe(60);
  });

  it("rejects values outside the design-canonical options", async () => {
    const response = await settingsPUT(settingsRequest("PUT", { key: "timeoutSec", value: 45 }));
    expect(response.status).toBe(400);
    expect(appSettingUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it("rejects unknown setting keys", async () => {
    const response = await settingsPUT(settingsRequest("PUT", { key: "readLimit", value: 10 }));
    expect(response.status).toBe(400);
  });

  it("persists a valid change and records a 設定変更 audit event", async () => {
    const response = await settingsPUT(settingsRequest("PUT", { key: "timeoutSec", value: 60 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.timeoutSec).toBeDefined();
    expect(appSettingUpsertMock).toHaveBeenCalledWith({
      where: { key: "timeoutSec" },
      update: { value: "60" },
      create: { key: "timeoutSec", value: "60" },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "設定変更",
        target: "タイムアウト",
        detail: "30秒 → 60秒",
        level: "info",
      },
    });
  });

  it("requires admin for setting changes", async () => {
    vi.stubEnv("CODIP_ALLOW_INSECURE_ADMIN", "false");
    const response = await settingsPUT(settingsRequest("PUT", { key: "timeoutSec", value: 60 }));
    expect([401, 503]).toContain(response.status);
    expect(appSettingUpsertMock).not.toHaveBeenCalled();
  });

  it("records whitelisted client events with server-side fixed content", async () => {
    const response = await auditEventsPOST(auditEventRequest({ kind: "audit_export_csv" }));
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "エクスポート",
        target: "監査ログ",
        detail: "CSV形式で出力",
        level: "info",
      },
    });
  });

  it("resolves API key event targets from sourceId on the server", async () => {
    dataSourceFindUniqueMock.mockResolvedValueOnce({ name: "e-Stat API" });
    const response = await auditEventsPOST(
      auditEventRequest({ kind: "apikey_save", sourceId: "src-1" }),
    );
    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        actor: "管理者",
        action: "APIキー保存",
        target: "e-Stat API",
        detail: "ブラウザ内にのみ保存(外部送信なし)",
        level: "success",
      },
    });
  });

  it("rejects unknown client event kinds (audit injection guard)", async () => {
    const response = await auditEventsPOST(
      auditEventRequest({ kind: "free_text", detail: "偽イベント" }),
    );
    expect(response.status).toBe(400);
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
