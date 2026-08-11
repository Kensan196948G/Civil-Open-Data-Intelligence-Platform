import { describe, expect, it } from "vitest";
import {
  csv,
  escapeCsv,
  printHtml,
  renderReport,
  REPORT_FORMATS,
  spreadsheetML,
  toMarkdown,
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

  it("renders Excel SpreadsheetML with escaped cells and numeric cells", () => {
    const body = spreadsheetML(HEADERS, ROWS, "daily", "site-1");
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"');
    expect(body).toContain('<Data ss:Type="Number">25.5</Data>');
    expect(body).toContain("普通 &lt;注&gt; &amp; 引用");
    expect(body).toContain("危険, 注意");
    expect(body).not.toContain("<script");
  });

  it("renders print HTML with escaping and a print button", () => {
    const body = printHtml(HEADERS, ROWS, "daily", "site-1");
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("@media print");
    expect(body).toContain("window.print()");
    expect(body).toContain("&lt;注&gt;");
    expect(body).not.toContain("<注>");
  });

  it("maps renderReport to content types and extensions", () => {
    expect(renderReport("csv", HEADERS, ROWS, "daily", "site-1")).toMatchObject({
      contentType: "text/csv; charset=utf-8",
      extension: "csv",
    });
    expect(renderReport("xlsx", HEADERS, ROWS, "daily", "site-1")).toMatchObject({
      contentType: "application/vnd.ms-excel; charset=utf-8",
      extension: "xml",
    });
    expect(renderReport("pdf", HEADERS, ROWS, "daily", "site-1")).toMatchObject({
      contentType: "text/html; charset=utf-8",
      extension: "html",
    });
  });
});
