/**
 * レポート出力フォーマット（CSV / Markdown / Excel OOXML .xlsx / 印刷用HTML）。
 *
 * Excel 出力は OOXML (.xlsx) を fflate（Worker 互換・~15KB の zip 実装）で
 * 生成する。依存を最小化しつつ、Excel / LibreOffice がネイティブに開ける
 * 本格形式を提供する（docs/design/report-export-decision.md）。
 *
 * PDF 出力は印刷用 HTML（@media print）を返し、ブラウザの「印刷 → PDF に保存」で
 * 帳票化する。サーバー側 PDF 生成は日本語フォント埋め込みと Workers 制約のため
 * 導入しない（docs/design/report-export-decision.md）。
 */

import { zipSync } from "fflate";

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
    // XML 1.0 で禁止されている制御文字（U+0000, U+000B, U+000C, U+000E–U+001F）は
    // 実体参照でも表現できないため、置換文字（U+FFFD）へ置き換える。
    .replace(/[\u0000\u000B\u000C\u000E-\u001F]/g, "\uFFFD")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

function columnName(index: number): string {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

/**
 * 実 OOXML (.xlsx) ワークブックを生成する。
 * 最小構成（Content_Types / rels / workbook / worksheet / styles）を fflate で zip 化する。
 * 数値セルは数値として、それ以外は inlineStr でエスケープして書き出す。
 */
export function xlsxWorkbook(headers: string[], rows: unknown[][]): Uint8Array {
  const cells = (values: unknown[], startRow: number, header = false): string[] =>
    values.map((value, index) => {
      const ref = `${columnName(index)}${startRow}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"${header ? ' s="1"' : ""}><v>${value}</v></c>`;
      }
      const text = value == null ? "" : String(value);
      return `<c r="${ref}"${header ? ' s="1"' : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    });

  const headerCells = cells(headers, 1, true);
  const bodyRowsXml = rows
    .map((row, index) => `<row r="${index + 2}">${cells(row, index + 2).join("")}</row>`)
    .join("");
  const sheet = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `  <sheetData><row r="1">${headerCells.join("")}</row>${bodyRowsXml}</sheetData>`,
    "</worksheet>",
  ].join("\n");

  const workbook = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '  <sheets><sheet name="report" sheetId="1" r:id="rId1"/></sheets>',
    "</workbook>",
  ].join("\n");

  const styles = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>',
    '  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>',
    '  <borders count="1"><border/></borders>',
    '  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    '  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>',
    "</styleSheet>",
  ].join("\n");

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    "</Types>",
  ].join("\n");

  const rootRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    "</Relationships>",
  ].join("\n");

  const workbookRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    "</Relationships>",
  ].join("\n");

  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
  return zipSync(
    {
      "[Content_Types].xml": encode(contentTypes),
      "_rels/.rels": encode(rootRels),
      "xl/workbook.xml": encode(workbook),
      "xl/_rels/workbook.xml.rels": encode(workbookRels),
      "xl/worksheets/sheet1.xml": encode(sheet),
      "xl/styles.xml": encode(styles),
    },
    { level: 6 },
  );
}

/** 印刷用HTML。ブラウザの「印刷 → PDFに保存」で帳票PDFを生成する。 */
export function printHtml(headers: string[], rows: unknown[][], template: string, siteId: string): string {
  const generatedAt = new Date().toISOString();
  const tableRows = [
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
    "    @page { size: A4; margin: 14mm 12mm; }",
    "    h1 { font-size: 18px; margin: 0 0 8px; }",
    "    .meta { font-size: 12px; color: #444; margin-bottom: 16px; }",
    "    table { border-collapse: collapse; width: 100%; font-size: 11px; }",
    "    th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }",
    "    th { background: #eee; }",
    "    thead { display: table-header-group; }",
    "    tr { page-break-inside: avoid; }",
    "    .disclaimer { margin-top: 16px; font-size: 10px; color: #666; }",
    "    .signature { margin-top: 28px; display: flex; justify-content: space-between; gap: 24px; }",
    "    .signature div { border-top: 1px solid #555; padding-top: 4px; font-size: 11px; width: 220px; text-align: center; }",
    "    .footer { margin-top: 20px; font-size: 9px; color: #888; border-top: 1px solid #ccc; padding-top: 6px; }",
    "    @media print { body { margin: 0; } .no-print { display: none; } .disclaimer, .footer { color: #333; } }",
    "  </style>",
    "</head>",
    "<body>",
    `  <h1>${escapeHtml(template)} レポート</h1>`,
    `  <div class="meta">現場: ${escapeHtml(siteId)} ｜ 生成日時: ${escapeHtml(generatedAt)}</div>`,
    '  <p class="no-print"><button onclick="window.print()">このページを印刷 / PDF保存</button></p>',
    "  <table>",
    "  <thead>",
    `    <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`,
    "  </thead>",
    "  <tbody>",
    tableRows,
    "  </tbody>",
    "  </table>",
    "  <p class=\"disclaimer\">⚠️ 本レポートは確認支援です。施工可否・安全性・法令適合を断定しません。出典・基準日・取得日時を確認のうえ、最終判断は担当者が行ってください。</p>",
    "  <div class=\"signature\">",
    "    <div>作成者</div>",
    "    <div>確認者</div>",
    "    <div>承認者</div>",
    "  </div>",
    `  <p class="footer">CODIP ｜ 生成日時: ${generatedAt} ｜ 現場: ${escapeHtml(siteId)} ｜ テンプレート: ${escapeHtml(template)}</p>`,
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
  body: string | Blob;
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
      // ArrayBufferLike（SharedArrayBuffer含む）をそのまま渡すと型・実装が
      // 環境依存になるため、ArrayBuffer 上の新しい Uint8Array へコピーして
      // Blob 化する（Workers / Node 両対応）。
      return {
        body: new Blob([new Uint8Array(xlsxWorkbook(headers, rows))], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      };
    case "pdf":
      return {
        body: printHtml(headers, rows, template, siteId),
        contentType: "text/html; charset=utf-8",
        extension: "html",
      };
  }
}
