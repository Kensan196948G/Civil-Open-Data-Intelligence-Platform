import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  csv,
  escapeCsv,
  printHtml,
  renderReport,
  REPORT_FORMATS,
  toMarkdown,
  xlsxWorkbook,
} from "../../src/lib/report-export";

const HEADERS = ["observedAt", "temperatureC", "note"];
const ROWS: unknown[][] = [
  ["2026-08-12T01:00:00Z", 25.5, "普通 <注> & 引用"],
  [null, undefined, "危険, 注意"],
];

describe("report export formats", () => {
  it("supports csv/markdown/xlsx/pdf", () => {
    expect(REPORT_FORMATS).toEqual(["csv", "markdown", "xlsx", "pdf"]);
  });

  it("escapes CSV values", () => {
    expect(escapeCsv('a,b"c')).toBe('"a,b""c"');
    expect(escapeCsv(null)).toBe("");
    expect(csv(HEADERS, ROWS)).toContain('"危険, 注意"');
  });

  it("renders Markdown with the disclaimer", () => {
    const body = toMarkdown(HEADERS, ROWS, "daily", "site-1");
    expect(body).toContain("# daily レポート");
    expect(body).toContain("| observedAt | temperatureC | note |");
    expect(body).toContain("施工可否・安全性・法令適合を断定しません");
  });

  it("renders a real OOXML .xlsx workbook with escaped cells and numeric cells", () => {
    const bytes = xlsxWorkbook(HEADERS, ROWS);
    const files = unzipSync(bytes);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    const workbook = strFromU8(files["xl/workbook.xml"]);
    const contentTypes = strFromU8(files["[Content_Types].xml"]);

    // ZIP として有効かつ OOXML の必須パーツを持つ
    expect(files["xl/worksheets/sheet1.xml"]).toBeDefined();
    expect(files["xl/workbook.xml"]).toBeDefined();
    expect(files["_rels/.rels"]).toBeDefined();
    expect(contentTypes).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    );
    expect(workbook).toContain('<sheet name="report" sheetId="1" r:id="rId1"/>');

    // ヘッダーは太字スタイル、数値セルは数値、文字列はエスケープされる
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">observedAt</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>25.5</v></c>');
    expect(sheet).toContain("普通 &lt;注&gt; &amp; 引用");
    expect(sheet).toContain("危険, 注意");
    expect(sheet).not.toContain("<script");
  });

  it("renders print HTML with escaping and a print button", () => {
    const body = printHtml(HEADERS, ROWS, "daily", "site-1");
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("@media print");
    expect(body).toContain("@page { size: A4");
    expect(body).toContain("window.print()");
    expect(body).toContain("<thead>");
    expect(body).toContain("display: table-header-group");
    expect(body).toContain('class="signature"');
    expect(body).toContain("作成者");
    expect(body).toContain('class="footer"');
    expect(body).toContain("&lt;注&gt;");
    expect(body).not.toContain("<注>");
  });

  it("maps renderReport to content types and extensions (xlsx is binary)", () => {
    expect(renderReport("csv", HEADERS, ROWS, "daily", "site-1")).toMatchObject({
      contentType: "text/csv; charset=utf-8",
      extension: "csv",
    });
    const xlsx = renderReport("xlsx", HEADERS, ROWS, "daily", "site-1");
    expect(xlsx).toMatchObject({
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
    });
    expect(xlsx.body).toBeInstanceOf(Blob);
    expect(xlsxWorkbook(HEADERS, ROWS)).toBeInstanceOf(Uint8Array);
    expect(renderReport("pdf", HEADERS, ROWS, "daily", "site-1")).toMatchObject({
      contentType: "text/html; charset=utf-8",
      extension: "html",
    });
  });
});
