import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findConnector } from "@/connectors/registry";
import { buildEstatUrl } from "@/connectors/estat";
import { isXroadUrl } from "@/connectors/xroad";
import { isPlateauUrl } from "@/connectors/plateau";
import { isKsjUrl } from "@/connectors/ksj";
import { isJmaXmlUrl } from "@/connectors/jma-xml";
import { hostMatches, hostPathMatches } from "@/connectors/host-match";
import type { ConnectorSource } from "@/connectors/types";
import { SOURCES } from "../../prisma/seed-data";

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

  it.each([
    "https://evil.example/?x=nlftp.mlit.go.jp",
    "https://evil.example/#data.jma.go.jp",
    "https://evil.example/geospatial.jp/dataset",
    "https://nlftp.mlit.go.jp.evil.example/ksj/",
    "https://xml.kishou.go.jp.evil.example/",
    "https://geospatial.jp.evil.example/",
  ])("ホスト名を偽装したURLは generic へ落ちる: %s", (url) => {
    expect(findConnector(source({ endpointUrl: url })).name).toBe("generic");
  });

  /**
   * registry の並びは gsi → jma-xml → estat → ksj → plateau → xroad の先勝ち。
   * plateau が `mlit.go.jp` をホスト単位で担当すると、後ろにいる xroad を横取りする。
   */
  it("PLATEAU は国交省ドメインの他サービスを横取りしない", () => {
    expect(findConnector(source({ officialUrl: "https://www.xroad.mlit.go.jp/" })).name).toBe(
      "xroad",
    );
    expect(findConnector(source({ officialUrl: "https://nlftp.mlit.go.jp/ksj/" })).name).toBe("ksj");
    for (const url of [
      "https://www.netis.mlit.go.jp/netis/",
      "https://www.reinfolib.mlit.go.jp/",
      "https://road-structures-db.mlit.go.jp/",
      "https://www.mlit.go.jp/road/census/r3/",
      "https://plateauview.mlit.go.jp/",
    ]) {
      expect(findConnector(source({ officialUrl: url })).name).toBe("generic");
    }
  });

  /**
   * jma-xml.check は本文が `<` で始まらなければ parse_error にする。
   * 担当範囲を `jma.go.jp` へ広げると、台帳の JSON 配信が一斉に失敗する。
   */
  it("防災情報XML は www.jma.go.jp のJSON配信を担当しない", () => {
    for (const url of [
      "https://www.jma.go.jp/bosai/quake/data/list.json",
      "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt",
      "https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json",
    ]) {
      expect(findConnector(source({ endpointUrl: url })).name).toBe("generic");
    }
    expect(
      findConnector(source({ endpointUrl: "https://www.data.jma.go.jp/developer/xml/feed/regular.xml" }))
        .name,
    ).toBe("jma-xml");
  });
});

describe("台帳の振り分け保存", () => {
  /**
   * `prisma/seed-data.ts` の全データソースについて、専用コネクタへ振り分けられる組を固定する。
   *
   * ホスト判定の実装を変えたとき、実在データソースの振り分けが動いたことを検出するための表。
   * 新しいデータソースが generic に落ちる分にはこの表は動かない。専用コネクタを増減させる
   * 変更のときだけ更新が要る = 危険な変更にだけ速度制限がかかる。
   */
  const EXPECTED_SPECIALIZED: [string, string][] = [
    ["estat", "https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList"],
    [
      "gsi-elevation",
      "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=140.08531&lat=36.103543&outtype=JSON",
    ],
    ["jma-xml", "https://www.data.jma.go.jp/developer/xml/feed/regular.xml"],
    ["jma-xml", "https://www.data.jma.go.jp/obd/stats/etrn/"],
    ["jma-xml", "https://www.data.jma.go.jp/svd/eqdb/data/shindo/"],
    ["ksj", "https://nlftp.mlit.go.jp/isj/"],
    ["ksj", "https://nlftp.mlit.go.jp/ksj/"],
    ["ksj", "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A22.html"],
    ["plateau", "https://www.geospatial.jp/ckan/api/3/action/package_search?q=点群"],
    ["plateau", "https://www.geospatial.jp/ckan/dataset/plateau"],
    ["plateau", "https://www.geospatial.jp/ckan/dataset/shizuoka-2019-pointcloud"],
    ["xroad", "https://api.jartic-open-traffic.org/geoserver"],
    ["xroad", "https://www.xroad.mlit.go.jp/"],
  ];

  it("台帳の各データソースが従来どおりのコネクタへ振り分けられる", () => {
    const actual = SOURCES.map((seed, index) => {
      const src = source({
        id: String(index),
        name: seed.name,
        officialUrl: seed.officialUrl,
        endpointUrl: seed.endpointUrl ?? null,
        requiresApiKey: seed.requiresApiKey,
        apiKeyEnvName: seed.apiKeyEnvName ?? null,
        category: seed.category,
        dataFormat: seed.dataFormat,
      });
      return [findConnector(src).name, src.endpointUrl ?? src.officialUrl] as [string, string];
    })
      .filter(([name]) => name !== "generic")
      .sort();

    expect(actual).toEqual([...EXPECTED_SPECIALIZED].sort());
  });
});

describe("ホスト判定の契約", () => {
  const connectorDir = path.resolve(import.meta.dirname, "..", "..", "src", "connectors");

  /**
   * 文字列包含によるホスト判定の再発を機械的に止める。
   *
   * CodeQL の `js/incomplete-url-substring-sanitization` は同じ欠陥のうち 1 件しか
   * 検出しなかった (Issue #142 / #147)。**スキャナの沈黙は網羅の証拠にならない**ため、
   * 検出に頼らずリポジトリ内の述語で押さえる。
   *
   * ホスト判定以外の正当な用途で `.includes(` が必要になった場合は、この検査に
   * 例外リストを足すのではなく、判定を絞り込むこと。例外リストは
   * 「リストにあるから通る」という閉塞した検査経路へ退化する。
   */
  it("src/connectors に文字列包含によるホスト判定が残っていない", () => {
    const offenders = readdirSync(connectorDir)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        readFileSync(path.join(connectorDir, file), "utf8")
          .split("\n")
          .map((line, index) => ({ file, line: index + 1, text: line }))
          .filter(({ text }) => text.includes(".includes(")),
      )
      .map(({ file, line, text }) => `${file}:${line}: ${text.trim()}`);

    expect(offenders).toEqual([]);
  });

  it("全コネクタが hostMatches / hostPathMatches 経由でホストを判定している", () => {
    for (const file of ["xroad.ts", "plateau.ts", "ksj.ts", "jma-xml.ts"]) {
      expect(readFileSync(path.join(connectorDir, file), "utf8")).toContain(
        '@/connectors/host-match"',
      );
    }
  });
});

describe("hostMatches / hostPathMatches", () => {
  const domains = ["example.go.jp"] as const;

  it.each([
    ["https://example.go.jp/", true],
    ["https://www.example.go.jp/path", true],
    ["https://a.b.example.go.jp/", true],
    // 文字列包含なら通ってしまうもの
    ["https://evil.example/?x=example.go.jp", false],
    ["https://evil.example/example.go.jp", false],
    ["https://evil.example/#example.go.jp", false],
    ["https://example.go.jp.evil.example/", false],
    // ドット無しサフィックス比較なら通ってしまうもの
    ["https://evilexample.go.jp/", false],
    // userinfo によるホスト偽装
    ["https://example.go.jp@evil.example/", false],
    // 非HTTPS
    ["http://example.go.jp/", false],
    ["ftp://example.go.jp/", false],
  ] as const)("hostMatches(%s) === %s", (url, expected) => {
    expect(hostMatches(url, domains)).toBe(expected);
  });

  it.each(["", "   ", "not a url", "example.go.jp", "//example.go.jp/x"])(
    "パース不能な文字列は例外を投げずに false: %s",
    (value) => {
      expect(() => hostMatches(value, domains)).not.toThrow();
      expect(hostMatches(value, domains)).toBe(false);
    },
  );

  it("null / undefined を安全に扱う", () => {
    expect(hostMatches(null, domains)).toBe(false);
    expect(hostMatches(undefined, domains)).toBe(false);
    expect(hostPathMatches(null, domains, "/x")).toBe(false);
  });

  it.each([
    ["https://example.go.jp/target", true],
    ["https://example.go.jp/target/", true],
    ["https://example.go.jp/target/child/page.html", true],
    ["https://www.example.go.jp/target/", true],
    // パスが違う
    ["https://example.go.jp/", false],
    ["https://example.go.jp/other", false],
    // 前置一致だが別ディレクトリ
    ["https://example.go.jp/targetting", false],
    // パスは合うがホストが違う
    ["https://evil.example/target/", false],
  ] as const)("hostPathMatches(%s, '/target') === %s", (url, expected) => {
    expect(hostPathMatches(url, domains, "/target")).toBe(expected);
  });
});

describe("isPlateauUrl", () => {
  it.each([
    "https://www.geospatial.jp/ckan/dataset/plateau",
    "https://front.geospatial.jp/",
    "https://geospatial.jp/",
    "https://www.mlit.go.jp/plateau/",
    "https://www.mlit.go.jp/plateau",
  ])("PLATEAU 系を受理する: %s", (url) => {
    expect(isPlateauUrl(url)).toBe(true);
  });

  it.each([
    // 国交省ドメインでも /plateau 配下でなければ担当しない
    "https://www.xroad.mlit.go.jp/",
    "https://www.netis.mlit.go.jp/netis/",
    "https://plateauview.mlit.go.jp/",
    "https://www.mlit.go.jp/road/census/r3/",
    // 偽装
    "https://evil.example/?x=geospatial.jp",
    "https://geospatial.jp.evil.example/",
    "https://evilgeospatial.jp/",
    "http://www.geospatial.jp/ckan/dataset/plateau",
  ])("担当外を拒否する: %s", (url) => {
    expect(isPlateauUrl(url)).toBe(false);
  });
});

describe("isKsjUrl", () => {
  it.each(["https://nlftp.mlit.go.jp/ksj/", "https://nlftp.mlit.go.jp/isj/"])(
    "KSJ 系を受理する: %s",
    (url) => {
      expect(isKsjUrl(url)).toBe(true);
    },
  );

  it.each([
    "https://www.mlit.go.jp/",
    "https://evil.example/?x=nlftp.mlit.go.jp",
    "https://nlftp.mlit.go.jp.evil.example/",
    "https://evilnlftp.mlit.go.jp/",
    "http://nlftp.mlit.go.jp/ksj/",
  ])("担当外を拒否する: %s", (url) => {
    expect(isKsjUrl(url)).toBe(false);
  });
});

describe("isJmaXmlUrl", () => {
  it.each([
    "https://www.data.jma.go.jp/developer/xml/feed/regular.xml",
    "https://data.jma.go.jp/",
    "https://xml.kishou.go.jp/",
  ])("防災情報XML 系を受理する: %s", (url) => {
    expect(isJmaXmlUrl(url)).toBe(true);
  });

  it.each([
    // 担当範囲を jma.go.jp へ広げると壊れるもの
    "https://www.jma.go.jp/bosai/quake/data/list.json",
    "https://www.jma.go.jp/",
    // 偽装
    "https://evil.example/#data.jma.go.jp",
    "https://data.jma.go.jp.evil.example/",
    "https://evildata.jma.go.jp/",
    "http://xml.kishou.go.jp/",
  ])("担当外を拒否する: %s", (url) => {
    expect(isJmaXmlUrl(url)).toBe(false);
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
