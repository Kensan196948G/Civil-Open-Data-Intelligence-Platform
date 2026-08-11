/**
 * レポート出力フォーマット（CSV / Markdown / Excel 2003 XML / 印刷用HTML）。
 *
 * Excel 出力は OOXML (.xlsx) ではなく SpreadsheetML 2003 XML を使用する。
 * 依存ライブラリを増やさず Excel / LibreOffice で開けることを優先したプロトタイプ
 * （docs/14-roadmap.md の PDF/Excel 出力 Phase 1 項目）。本格 .xlsx は
 * OOXML 生成ライブラリ導入と併せて別Issueで扱う。
 *
 * PDF 出力は印刷用 HTML（@media print）を返し、ブラウザの「印刷 → PDF に保存」で
 * 帳票化する。サーバー側 PDF 生成ライブラリは導入していない。
 */

export type ReportFormat = "csv" | "markdown" | "xlsx" | "pdf";

export const REPORT_FORMATS: readonly ReportFormat[] = ["csv", "markdown", "xlsx", "pdf"];

export function escapeCsv(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
}

function escapeHtml(value: unknown): string {
  const text = value == null ? "" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value: unknown): string {
  return escapeHtml(value)
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

/** Excel 2003 SpreadsheetML。Excel / LibreOffice で開ける依存なしのExcel出力。 */
export function spreadsheetML(headers: string[], rows: unknown[][], template: string, siteId: string): string {
  const cells = (values: unknown[]): string =>
    values
      .map((value) => {
        const text = value == null ? "" : String(value);
        // 数値は数値セルとして出力し、文字列はエスケープする。
        const numeric = typeof value === "number" && Number.isFinite(value);
        return numeric
          ? `<Cell><Data ss:Type="Number">${value}</Data></Cell>`
          : `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
      })
      .join("");

  const headerRow = `<Row>${cells(headers)}</Row>`;
  const bodyRows = rows.map((row) => `<Row>${cells(row)}</Row>`).join("\n");
  const generatedAt = new Date().toISOString();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    " <Worksheet ss:Name=\"report\">",
    "  <Table>",
    headerRow,
    bodyRows,
    "  </Table>",
    " </Worksheet>",
    "</Workbook>",
    "",
    `<!-- template=${escapeXml(template)} site=${escapeXml(siteId)} generated=${escapeXml(generatedAt)} -->`,
  ].join("\n");
}

/** 印刷用HTML。ブラウザの「印刷 → PDFに保存」で帳票PDFを生成する。 */
export function printHtml(headers: string[], rows: unknown[][], template: string, siteId: string): string {
  const generatedAt = new Date().toISOString();
  const tableRows = [
    `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`,
    ...rows.map(
      (row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`,
    ),
  ].join("\n");

  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '  <meta charset="utf-8" />',
    "  <title>CODIP レポート印刷</title>",
    "  <style>",
    "    body { font-family: 'BIZ UDPGothic', 'Noto Sans JP', sans-serif; color: #111; margin: 24px; }",
    "    h1 { font-size: 18px; margin: 0 0 8px; }",
    "    .meta { font-size: 12px; color: #444; margin-bottom: 16px; }",
    "    table { border-collapse: collapse; width: 100%; font-size: 11px; }",
    "    th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }",
    "    th { background: #eee; }",
    "    .disclaimer { margin-top: 16px; font-size: 10px; color: #666; }",
    "    @media print { body { margin: 8mm; } .no-print { display: none; } }",
    "  </style>",
    "</head>",
    "<body>",
    `  <h1>${escapeHtml(template)} レポート</h1>`,
    `  <div class="meta">現場: ${escapeHtml(siteId)} ｜ 生成日時: ${escapeHtml(generatedAt)}</div>`,
    '  <p class="no-print"><button onclick="window.print()">このページを印刷 / PDF保存</button></p>',
    "  <table>",
    tableRows,
    "  </table>",
    "  <p class=\"disclaimer\">⚠️ 本レポートは確認支援です。施工可否・安全性・法令適合を断定しません。出典・基準日・取得日時を確認のうえ、最終判断は担当者が行ってください。</p>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export function toMarkdown(headers: string[], rows: unknown[][], template: string, siteId: string): string {
  const lines = [
    `# ${template} レポート`,
    "",
    `- 現場: ${siteId}`,
    `- 生成日時: ${new Date().toISOString()}`,
    "",
    "| " + headers.join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
    ...rows.map((row) => "| " + row.map((v) => String(v ?? "")).join(" | ") + " |"),
    "",
    "> ⚠️ 本レポートは確認支援です。施工可否・安全性・法令適合を断定しません。",
  ];
  return lines.join("\n") + "\n";
}

export interface ReportContent {
  body: string;
  contentType: string;
  extension: string;
}

export function renderReport(
  format: ReportFormat,
  headers: string[],
  rows: unknown[][],
  template: string,
  siteId: string,
): ReportContent {
  switch (format) {
    case "csv":
      return {
        body: csv(headers, rows),
        contentType: "text/csv; charset=utf-8",
        extension: "csv",
      };
    case "markdown":
      return {
        body: toMarkdown(headers, rows, template, siteId),
        contentType: "text/markdown; charset=utf-8",
        extension: "md",
      };
    case "xlsx":
      return {
        body: spreadsheetML(headers, rows, template, siteId),
        contentType: "application/vnd.ms-excel; charset=utf-8",
        extension: "xml",
      };
    case "pdf":
      return {
        body: printHtml(headers, rows, template, siteId),
        contentType: "text/html; charset=utf-8",
        extension: "html",
      };
  }
}
