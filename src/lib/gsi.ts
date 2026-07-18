/** 地理院標高APIのエンドポイントを緯度経度で組み立てる */
export function buildElevationUrl(baseEndpoint: string, lat: number, lon: number): string {
  const url = new URL(baseEndpoint);
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("outtype", "JSON");
  return url.toString();
}

/** 台帳に登録されたURLが国土地理院の標高APIエンドポイントかを厳格に確認する */
export function isGsiElevationEndpoint(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "cyberjapandata2.gsi.go.jp" &&
      url.pathname === "/general/dem/scripts/getelevation.php"
    );
  } catch {
    return false;
  }
}

export type ElevationResult = {
  /** 標高値(m)。海域・範囲外は null */
  elevation: number | null;
  /** 標高データソース種別 (5m/10mメッシュ等) */
  hsrc: string | null;
};

/** 地理院標高APIのレスポンス(JSON文字列)を解釈する。解釈不能なら null */
export function parseElevationResponse(body: string): ElevationResult | null {
  try {
    const json = JSON.parse(body) as { elevation?: unknown; hsrc?: unknown };
    if (!("elevation" in json)) return null;
    const elevation =
      typeof json.elevation === "number" && Number.isFinite(json.elevation)
        ? json.elevation
        : null; // "-----" (海域等) は null 扱い
    const hsrc = typeof json.hsrc === "string" ? json.hsrc : null;
    return { elevation, hsrc };
  } catch {
    return null;
  }
}

/** 緯度経度の妥当性検証 */
export function isValidLatLon(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}
