import { describe, expect, it } from "vitest";
import { attachmentDisposition, sanitizeFilename } from "@/lib/content-disposition";

/**
 * Content-Disposition のヘッダ組み立て（Deep Debug Round 7）。
 *
 * `POST /api/v1/reports` は `typeof body?.siteId === "string"` しか検証していない
 * `siteId` の先頭 8 文字を
 *
 *   attachment; filename="report_${template}_${siteId.slice(0, 8)}.${ext}"
 *
 * へそのまま埋めていた。`siteId` に `"` を含めると引用符を破り、別のヘッダ
 * パラメータを注入できた。`Headers` API が CRLF を拒否するためレスポンス分割には
 * 至らないが、ヘッダ値の構造をリクエスト側から壊せる状態だった。
 */
describe("sanitizeFilename", () => {
  it("引用符を残さない（ヘッダパラメータ注入の直接原因）", () => {
    // siteId = 'a"; x="' を先頭8文字で切り出した場合に相当する。
    const injected = sanitizeFilename('report_daily_a"; x=".csv');

    expect(injected).not.toContain('"');
    expect(injected).not.toContain(";");
  });

  it("CR / LF / セミコロン / 空白を落とす", () => {
    expect(sanitizeFilename("a\r\nb c;d")).toBe("a__b_c_d");
  });

  it("パス区切りを残さない（保存先の取り違えを防ぐ）", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("..\\..\\win.ini")).not.toContain("\\");
  });

  it("先頭のドットを落とす（隠しファイル化と .. を無害化する）", () => {
    expect(sanitizeFilename("..")).toBe("download");
    expect(sanitizeFilename(".env")).toBe("env");
  });

  it("通常のファイル名は変えない", () => {
    expect(sanitizeFilename("report_daily_cmsm8xjh.csv")).toBe("report_daily_cmsm8xjh.csv");
    expect(sanitizeFilename("codip-terrain-35.36072-138.72726-2026-09-09.json")).toBe(
      "codip-terrain-35.36072-138.72726-2026-09-09.json",
    );
  });

  it("空になる入力でも空のファイル名を返さない", () => {
    expect(sanitizeFilename("")).toBe("download");
    expect(sanitizeFilename("!!!")).toBe("___");
  });

  it("長さを制限する", () => {
    expect(sanitizeFilename("a".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("attachmentDisposition", () => {
  it("ヘッダ値として引用符の対応が壊れない", () => {
    const value = attachmentDisposition('report_a"; x=".csv');

    // 引用符はちょうど 2 つ（開きと閉じ）だけ。
    expect((value.match(/"/g) ?? []).length).toBe(2);
    expect(value.startsWith('attachment; filename="')).toBe(true);
    expect(value.endsWith('"')).toBe(true);
  });

  it("Headers に載せても例外にならず、値が保たれる", () => {
    // 実際に Headers へ通すことで、組み立て結果が仕様上妥当であることを確かめる。
    const headers = new Headers({
      "Content-Disposition": attachmentDisposition("report_daily_cmsm8xjh.csv"),
    });

    expect(headers.get("Content-Disposition")).toBe(
      'attachment; filename="report_daily_cmsm8xjh.csv"',
    );
  });
});
