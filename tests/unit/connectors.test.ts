import { describe, expect, it } from "vitest";
import { findConnector } from "@/connectors/registry";
import { buildEstatUrl } from "@/connectors/estat";
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
});
