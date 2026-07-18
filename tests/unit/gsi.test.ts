import { describe, expect, it } from "vitest";
import { buildElevationUrl, isGsiElevationEndpoint, isValidLatLon, parseElevationResponse } from "@/lib/gsi";

const BASE =
  "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=140.08531&lat=36.103543&outtype=JSON";

describe("buildElevationUrl", () => {
  it("lat/lon を指定値で上書きする", () => {
    const url = new URL(buildElevationUrl(BASE, 35.681, 139.767));
    expect(url.searchParams.get("lat")).toBe("35.681");
    expect(url.searchParams.get("lon")).toBe("139.767");
    expect(url.searchParams.get("outtype")).toBe("JSON");
    expect(url.hostname).toBe("cyberjapandata2.gsi.go.jp");
  });
});

describe("isGsiElevationEndpoint", () => {
  it("国土地理院標高APIの正規HTTPSエンドポイントのみ許可する", () => {
    expect(isGsiElevationEndpoint(BASE)).toBe(true);
    expect(isGsiElevationEndpoint("http://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php")).toBe(false);
    expect(isGsiElevationEndpoint("https://evil.example/general/dem/scripts/getelevation.php?next=cyberjapandata2.gsi.go.jp")).toBe(false);
    expect(isGsiElevationEndpoint("https://cyberjapandata2.gsi.go.jp/general/dem/other.php")).toBe(false);
    expect(isGsiElevationEndpoint(null)).toBe(false);
  });
});

describe("parseElevationResponse", () => {
  it("正常レスポンスを解釈する", () => {
    expect(parseElevationResponse('{"elevation":25.3,"hsrc":"5m(レーザ)"}')).toEqual({
      elevation: 25.3,
      hsrc: "5m(レーザ)",
    });
  });

  it("海域等の '-----' は elevation null", () => {
    expect(parseElevationResponse('{"elevation":"-----","hsrc":"-----"}')).toEqual({
      elevation: null,
      hsrc: "-----",
    });
  });

  it("elevation キーが無ければ null", () => {
    expect(parseElevationResponse('{"foo":1}')).toBeNull();
  });

  it("JSONでなければ null", () => {
    expect(parseElevationResponse("<html>error</html>")).toBeNull();
  });
});

describe("isValidLatLon", () => {
  it.each([
    [35.681, 139.767, true],
    [-90, -180, true],
    [90, 180, true],
    [90.1, 0, false],
    [0, 180.1, false],
    [NaN, 139, false],
    [35, Infinity, false],
  ])("(%s, %s) → %s", (lat, lon, expected) => {
    expect(isValidLatLon(lat as number, lon as number)).toBe(expected);
  });
});
