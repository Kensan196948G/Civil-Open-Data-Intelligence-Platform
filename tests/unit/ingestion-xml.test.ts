import { describe, expect, test } from "vitest";
import { parseJmaAtomFeed, parsePayload } from "../../scripts/ingestion/ingestion-engine";

const SAMPLE_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" lang="ja">
  <title>高頻度（定時）</title>
  <updated>2026-08-10T07:31:37+09:00</updated>
  <entry>
    <title>気象警報・注意報（Ｒ０６）（集約通報）</title>
    <id>https://www.data.jma.go.jp/developer/xml/data/20260809223058_0_VPWS50_010000.xml</id>
    <updated>2026-08-09T22:30:55Z</updated>
    <author><name>気象庁</name></author>
    <link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/20260809223058_0_VPWS50_010000.xml"/>
    <content type="text"><![CDATA[【警戒・注意事項集約定時通報】]]></content>
  </entry>
  <entry>
    <title>震源・震度に関する情報</title>
    <id>https://www.data.jma.go.jp/developer/xml/data/20260810022336_0_VXSE51_010000.xml</id>
    <updated>2026-08-10T02:26:00Z</updated>
    <link type="application/xml" href="https://www.data.jma.go.jp/developer/xml/data/20260810022336_0_VXSE51_010000.xml"/>
    <content type="text">【震源・震度情報】</content>
  </entry>
</feed>`;

describe("気象庁防災情報XML (Atom feed) パース", () => {
  test("entry 単位で title/id/url/updated/summary を抽出する", () => {
    const rows = parseJmaAtomFeed(SAMPLE_FEED);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toContain("気象警報・注意報");
    expect(rows[0].id).toContain("VPWS50");
    expect(rows[0].url).toContain("20260809223058");
    expect(rows[0].updated).toBe("2026-08-09T22:30:55Z");
    expect(rows[0].summary).toContain("警戒・注意事項集約定時通報");
    expect(rows[1].title).toContain("震源・震度");
  });

  test("contentType が XML の場合は Atom としてパースされる", () => {
    const candidates = parsePayload(SAMPLE_FEED, "text/xml", {
      name: "気象庁 防災情報XML",
      category: "weather",
      providerName: "気象庁",
      dataFormat: "XML",
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].title).toContain("気象警報・注意報");
    expect((candidates[0] as { properties: { provider?: string } }).properties.provider).toBe("気象庁");
  });

  test("dataFormat が XML でもパースされる", () => {
    const candidates = parsePayload(SAMPLE_FEED, "text/html; charset=utf-8", {
      name: "気象庁 防災情報XML",
      category: "weather",
      dataFormat: "XML",
    });
    expect(candidates).toHaveLength(2);
  });

  test("entry が無い XML はパースエラーになる", () => {
    expect(() =>
      parsePayload("<feed><title>empty</title></feed>", "text/xml", {
        name: "気象庁 防災情報XML",
        category: "weather",
        dataFormat: "XML",
      }),
    ).toThrow("entry を抽出できませんでした");
  });
});
