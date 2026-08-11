import { describe, expect, it } from "vitest";
import { findConnector } from "@/connectors/registry";
import { buildEstatUrl } from "@/connectors/estat";
import { isXroadUrl } from "@/connectors/xroad";
import type { ConnectorSource } from "@/connectors/types";

function source(overrides: Partial<ConnectorSource>): ConnectorSource {
  return {
    id: "test",
    name: "テスト",
    officialUrl: "https://example.com/",
    endpointUrl: null,
    requiresApiKey: false,
    apiKeyEnvName: null,
    category: "gis",
    dataFormat: "JSON",
    ...overrides,
  };
}

describe("findConnector", () => {
  it.each([
    [
      "gsi-elevation",
      source({
        endpointUrl:
          "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=140&lat=36&outtype=JSON",
      }),
    ],
    ["jma-xml", source({ endpointUrl: "https://www.data.jma.go.jp/developer/xml/feed/regular.xml" })],
    ["jma-xml", source({ officialUrl: "https://xml.kishou.go.jp/", endpointUrl: null })],
    ["estat", source({ endpointUrl: "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList" })],
    ["ksj", source({ officialUrl: "https://nlftp.mlit.go.jp/ksj/" })],
    ["plateau", source({ officialUrl: "https://www.mlit.go.jp/plateau/" })],
    ["plateau", source({ endpointUrl: "https://www.geospatial.jp/ckan/dataset/plateau" })],
    ["xroad", source({ officialUrl: "https://www.xroad.mlit.go.jp/" })],
    ["xroad", source({ endpointUrl: "https://api.jartic-open-traffic.org/geoserver" })],
  ])("%s コネクタが選択される", (name, src) => {
    expect(findConnector(src).name).toBe(name);
  });

  it("該当なしは generic にフォールバックする", () => {
    expect(findConnector(source({ officialUrl: "https://www.openstreetmap.org/" })).name).toBe(
      "generic",
    );
  });

  it("e-Stat はHTTPSかつ完全一致ホストだけ専用コネクタを選ぶ", () => {
    expect(
      findConnector(source({ endpointUrl: "https://evil.example/api?next=api.e-stat.go.jp" })).name,
    ).toBe("generic");
    expect(
      findConnector(source({ endpointUrl: "http://api.e-stat.go.jp/rest/3.0/app/json/getStatsList" }))
        .name,
    ).toBe("generic");
  });

  it("xROAD はホスト名を偽装したURLで専用コネクタを選ばない", () => {
    expect(
      findConnector(source({ endpointUrl: "https://evil.example/?x=xroad.mlit.go.jp" })).name,
    ).toBe("generic");
    expect(findConnector(source({ officialUrl: "https://xroad.mlit.go.jp.evil.example/" })).name).toBe(
      "generic",
    );
  });
});

describe("isXroadUrl", () => {
  it.each([
    "https://xroad.mlit.go.jp/api/v1/road",
    "https://www.xroad.mlit.go.jp/",
    "https://sub.xroad.mlit.go.jp/dataset",
    "https://jartic-open-traffic.org/",
    "https://api.jartic-open-traffic.org/geoserver",
    // WHATWG URL は hostname を小文字化するので大文字表記も同一ホストとして通る
    "https://XROAD.MLIT.GO.JP/api",
  ])("xROAD 系ホストを受理する: %s", (url) => {
    expect(isXroadUrl(url)).toBe(true);
  });

  it.each([
    // クエリ・パス・フラグメントに現れるだけのドメイン名は受理しない
    "https://evil.example/?x=xroad.mlit.go.jp",
    "https://evil.example/xroad.mlit.go.jp/api",
    "https://evil.example/#jartic-open-traffic.org",
    // より長い登録可能ドメインの一部として現れるものは受理しない
    "https://xroad.mlit.go.jp.evil.example/",
    "https://jartic-open-traffic.org.evil.example/",
    // ドット無しサフィックス比較なら通ってしまうケース
    "https://evilxroad.mlit.go.jp/",
    "https://notjartic-open-traffic.org/",
    // 認証情報・ポートによるホスト偽装
    "https://xroad.mlit.go.jp@evil.example/",
    // 平文HTTP は estat / gsi の既存判定に揃えて受理しない
    "http://www.xroad.mlit.go.jp/",
    // スキーム偽装
    "javascript:alert('xroad.mlit.go.jp')",
  ])("偽装・非HTTPSを拒否する: %s", (url) => {
    expect(isXroadUrl(url)).toBe(false);
  });

  it.each(["", "   ", "not a url", "xroad.mlit.go.jp", "//xroad.mlit.go.jp/api"])(
    "パース不能な文字列は例外を投げずに false を返す: %s",
    (value) => {
      expect(() => isXroadUrl(value)).not.toThrow();
      expect(isXroadUrl(value)).toBe(false);
    },
  );

  it("null / undefined を安全に扱う", () => {
    expect(isXroadUrl(null)).toBe(false);
    expect(isXroadUrl(undefined)).toBe(false);
  });
});

describe("buildEstatUrl", () => {
  const estatSource = source({
    endpointUrl: "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList",
    requiresApiKey: true,
    apiKeyEnvName: "ESTAT_APP_ID",
  });

  it("環境変数にキーがあれば appId を付与する", () => {
    const url = buildEstatUrl(estatSource, { ESTAT_APP_ID: "test-key-123" });
    expect(url).toContain("appId=test-key-123");
  });

  it("環境変数が未設定ならそのままのURLを返す", () => {
    const url = buildEstatUrl(estatSource, {});
    expect(url).not.toContain("appId");
  });

  it("APIキー不要のデータソースには付与しない", () => {
    const url = buildEstatUrl(
      source({ endpointUrl: "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList" }),
      { ESTAT_APP_ID: "test-key-123" },
    );
    expect(url).not.toContain("appId");
  });

  it("e-Stat以外や平文HTTPには appId を付与しない", () => {
    expect(
      buildEstatUrl(
        source({
          endpointUrl: "https://evil.example/api?next=api.e-stat.go.jp",
          requiresApiKey: true,
          apiKeyEnvName: "ESTAT_APP_ID",
        }),
        { ESTAT_APP_ID: "test-key-123" },
      ),
    ).not.toContain("appId");
    expect(
      buildEstatUrl(
        source({
          endpointUrl: "http://api.e-stat.go.jp/rest/3.0/app/json/getStatsList",
          requiresApiKey: true,
          apiKeyEnvName: "ESTAT_APP_ID",
        }),
        { ESTAT_APP_ID: "test-key-123" },
      ),
    ).not.toContain("appId");
  });
});
