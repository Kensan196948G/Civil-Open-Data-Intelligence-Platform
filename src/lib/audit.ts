import { prisma } from "@/lib/db";

/**
 * 監査ログ (audit_logs) への記録ヘルパー。
 * デザイン正本の pushAudit と同じ語彙 (actor / action / target / detail / level) で
 * 操作・イベントの証跡を残す。
 */
export type AuditLevel = "info" | "success" | "warning" | "danger";

// デザイン正本 (AUDIT_LEVELS) と同一の配色・ラベル
export const AUDIT_LEVELS: Record<AuditLevel, { fg: string; bg: string; label: string }> = {
  info: { fg: "var(--blue)", bg: "var(--blue-bg)", label: "情報" },
  success: { fg: "var(--green)", bg: "var(--green-bg)", label: "成功" },
  warning: { fg: "var(--amber)", bg: "var(--amber-bg)", label: "警告" },
  danger: { fg: "var(--red)", bg: "var(--red-bg)", label: "危険" },
};

export function isAuditLevel(value: string): value is AuditLevel {
  return Object.hasOwn(AUDIT_LEVELS, value);
}

export type AuditEventInput = {
  actor?: "管理者" | "システム";
  action: string;
  target: string;
  detail: string;
  level?: AuditLevel;
};

export function auditLogCreateData(event: AuditEventInput) {
  return {
    actor: event.actor ?? "管理者",
    action: event.action,
    target: event.target,
    detail: event.detail,
    level: event.level ?? "info",
  };
}

/**
 * 監査イベントを1件記録する。記録失敗は主処理を失敗させない
 * (可用性優先。失敗自体はサーバーログへ残す)。
 * 主操作との同一トランザクション化 / outbox 方式による記録保証は Issue #46 で扱う
 * (設定変更のみ setOperationSetting が同一トランザクションで記録済み)。
 */
export async function recordAudit(event: AuditEventInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: auditLogCreateData(event),
    });
  } catch (error) {
    console.error(`[audit] failed to record event: ${event.action}`, error);
  }
}
