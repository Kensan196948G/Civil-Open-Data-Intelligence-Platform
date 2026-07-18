"use client";

import { notifyAuditEvent } from "@/lib/audit-events-client";

// 監査ログのエクスポート (CSV / HTML / PDF=印刷) を担うクライアント部品。
// 表本体は server component 側でレンダリングし、ここには整形済みの行データのみ渡す。
const AUDIT_EXPORT_HEADER = ["日時", "実行者", "操作", "対象", "詳細", "レベル"] as const;

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// エクスポート HTML は window.open 経由で描画・印刷されるため、
// 利用者入力（データソース名など）を必ずエスケープして XSS を防ぐ。
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function auditHtmlDoc(rows: string[][]): string {
  const headHtml = AUDIT_EXPORT_HEADER.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const rowsHtml = rows
    .map((r) => "<tr>" + r.map((v) => `<td>${escapeHtml(v)}</td>`).join("") + "</tr>")
    .join("");
  return (
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>監査ログ</title>' +
    "<style>body{font-family:sans-serif;padding:24px;color:#1A2433;}h1{font-size:20px;}" +
    "table{border-collapse:collapse;width:100%;margin-top:12px;}" +
    "th,td{border:1px solid #E3E8EF;padding:6px 10px;font-size:12.5px;text-align:left;}" +
    "th{background:#F2F4F8;}</style></head><body><h1>🔍 監査ログ</h1>" +
    "<table><thead><tr>" +
    headHtml +
    "</tr></thead><tbody>" +
    rowsHtml +
    "</tbody></table></body></html>"
  );
}

// Excel などでの数式インジェクションを防ぐため、危険な先頭文字を無害化してから引用符で囲む。
function csvCell(value: string): string {
  const text = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

export function AuditLogPanel({ rows }: { rows: string[][] }) {
  const exportCsv = (): void => {
    const all = [[...AUDIT_EXPORT_HEADER], ...rows];
    const csv = all.map((r) => r.map(csvCell).join(",")).join("\r\n");
    // 先頭に UTF-8 BOM を付与し Excel での文字化けを防ぐ
    downloadBlob("﻿" + csv, "audit-log.csv", "text/csv;charset=utf-8;");
    notifyAuditEvent("audit_export_csv");
  };

  const exportHtml = (): void => {
    downloadBlob(auditHtmlDoc(rows), "audit-log.html", "text/html;charset=utf-8;");
    notifyAuditEvent("audit_export_html");
  };

  // PDF は Blob URL を新規タブで開き、読み込み完了時に印刷ダイアログを起動する。
  // document.write を使わない (XSS/パフォーマンス回避)。データは escapeHtml 済み。
  const exportPdf = (): void => {
    const printDoc = auditHtmlDoc(rows).replace(
      "</body>",
      "<script>window.addEventListener('load',function(){window.print();});</script></body>",
    );
    const blob = new Blob([printDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) {
      URL.revokeObjectURL(url);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    notifyAuditEvent("audit_export_pdf");
  };

  return (
    <div className="flex gap-2">
      <button type="button" className="dc-btn-ghost" onClick={exportCsv}>
        📊 CSV
      </button>
      <button type="button" className="dc-btn-ghost" onClick={exportPdf}>
        📕 PDF
      </button>
      <button type="button" className="dc-btn-ghost" onClick={exportHtml}>
        🌐 HTML
      </button>
    </div>
  );
}
