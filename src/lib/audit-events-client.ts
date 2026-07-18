/**
 * クライアント側で完結した操作の監査イベント通知 (fire-and-forget)。
 * 記録内容はサーバー側 (/api/admin/audit-events) の kind 写像で固定される。
 * 管理セッションが無い場合は 401 になるが、主操作は妨げない。
 */
export function notifyAuditEvent(kind: string, sourceId?: string): void {
  void fetch("/api/admin/audit-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sourceId ? { kind, sourceId } : { kind }),
  }).catch(() => {
    // 監査通知の失敗で操作を妨げない
  });
}
