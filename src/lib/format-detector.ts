/** Content-Type とレスポンス先頭から形式を判定する */
export function detectFormat(contentType: string | null, preview: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  const body = (preview ?? "").trimStart();

  // Content-Type ベースの判定
  if (ct.includes("geo+json")) return "GeoJSON";
  if (ct.includes("json")) return looksLikeGeoJson(body) ? "GeoJSON" : "JSON";
  if (ct.includes("csv")) return "CSV";
  if (ct.includes("pdf")) return "PDF";
  if (ct.includes("png")) return "PNG";
  if (ct.includes("html")) return "HTML";
  if (ct.includes("xml")) return "XML";

  // 実体ベースの判定 (Content-Type と実体の不一致に備える)
  if (body.startsWith("%PDF")) return "PDF";
  if (body.charCodeAt(0) === 0x89 && body.slice(1, 4) === "PNG") return "PNG";
  if (body.startsWith("{") || body.startsWith("[")) {
    return looksLikeGeoJson(body) ? "GeoJSON" : "JSON";
  }
  if (/^<!doctype html/i.test(body) || /^<html/i.test(body)) return "HTML";
  if (body.startsWith("<?xml") || body.startsWith("<")) return "XML";
  if (looksLikeCsv(body)) return "CSV";
  return "unknown";
}

function looksLikeGeoJson(body: string): boolean {
  return /"type"\s*:\s*"(FeatureCollection|Feature|Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|GeometryCollection)"/.test(
    body,
  );
}

function looksLikeCsv(body: string): boolean {
  const lines = body
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .slice(0, 3);
  if (lines.length < 2) return false;
  const counts = lines.map((l) => l.split(",").length);
  return counts[0] >= 2 && counts.every((c) => c === counts[0]);
}
