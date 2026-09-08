import { describe, expect, it } from "vitest";
import { groupByOfficialUrlKey, officialUrlKey } from "../../scripts/lib/official-url";

/**
 * 公式URLの突き合わせキー (Issue #192)。
 *
 * seed の突き合わせも DB の一意インデックスも `officialUrl` の生文字列だったため、
 * シードの URL が `http://` から `https://` へ更新されると旧 scheme のレコードが
 * 残ったまま新しい行が作られ、同じデータソースが二重登録されていた。本番DBで
 * 「水文水質データベース」が 2 件 (`http://www1.river.go.jp/` と
 * `https://www1.river.go.jp/`) になっていることを 2026-09-09 に実測確認済み。
 *
 * 正規化しすぎると別資源を同一視してしまうため、吸収してよい差だけを固定する。
 */
describe("officialUrlKey", () => {
  it("scheme の違いを吸収する（Issue #192 の直接原因）", () => {
    expect(officialUrlKey("http://www1.river.go.jp/")).toBe(
      officialUrlKey("https://www1.river.go.jp/"),
    );
  });

  it("ホスト部の大文字小文字を吸収する", () => {
    expect(officialUrlKey("https://WWW1.River.GO.JP/")).toBe(
      officialUrlKey("https://www1.river.go.jp/"),
    );
  });

  it("末尾スラッシュの有無を吸収する", () => {
    expect(officialUrlKey("https://example.jp")).toBe(officialUrlKey("https://example.jp/"));
  });

  it("パス以降の大文字小文字は区別する（サーバによって別資源になりうる）", () => {
    expect(officialUrlKey("https://example.jp/Data")).not.toBe(
      officialUrlKey("https://example.jp/data"),
    );
  });

  it("別ホスト・別パスは同一視しない", () => {
    expect(officialUrlKey("https://a.example.jp/x")).not.toBe(
      officialUrlKey("https://b.example.jp/x"),
    );
    expect(officialUrlKey("https://example.jp/x")).not.toBe(officialUrlKey("https://example.jp/y"));
  });

  it("クエリ文字列は落とさない（別資源を同一視しないため）", () => {
    expect(officialUrlKey("https://example.jp/s?id=1")).not.toBe(
      officialUrlKey("https://example.jp/s?id=2"),
    );
  });

  it("文字列でない入力・空文字を安全に扱う", () => {
    expect(officialUrlKey(null)).toBe("");
    expect(officialUrlKey(undefined)).toBe("");
    expect(officialUrlKey(123)).toBe("");
    expect(officialUrlKey("   ")).toBe("");
  });

  it("前後の空白を無視する", () => {
    expect(officialUrlKey("  https://example.jp/  ")).toBe(officialUrlKey("https://example.jp"));
  });
});

describe("groupByOfficialUrlKey", () => {
  it("scheme 違いの重複を 1 グループにまとめる", () => {
    const rows = [
      { id: "old", officialUrl: "http://www1.river.go.jp/" },
      { id: "new", officialUrl: "https://www1.river.go.jp/" },
      { id: "other", officialUrl: "https://www.jma.go.jp/" },
    ];

    const groups = groupByOfficialUrlKey(rows);
    const duplicates = [...groups.values()].filter((group) => group.length > 1);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].map((row) => row.id).sort()).toEqual(["new", "old"]);
    // 生文字列の GROUP BY ではこの 2 件は別キーになり、検出できなかった。
    expect(new Set(rows.map((row) => row.officialUrl)).size).toBe(3);
  });

  it("重複がなければ全グループが 1 件", () => {
    const groups = groupByOfficialUrlKey([
      { id: "a", officialUrl: "https://a.example.jp/" },
      { id: "b", officialUrl: "https://b.example.jp/" },
    ]);

    expect([...groups.values()].every((group) => group.length === 1)).toBe(true);
  });
});
