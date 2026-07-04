import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchWithGuard, sanitizeUrl } from "@/lib/http-client";
import { buildElevationUrl, isValidLatLon, parseElevationResponse } from "@/lib/gsi";

/**
 * 地図クリック地点の標高取得。
 * 台帳に登録済みの地理院標高APIエンドポイントのみを取得対象とする
 * (任意URL取得は行わないセキュリティ方針を維持)。
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!isValidLatLon(lat, lon)) {
    return NextResponse.json(
      { error: "validation_error", message: "lat/lon の値が不正です" },
      { status: 400 },
    );
  }

  const source = await prisma.dataSource.findFirst({
    where: { endpointUrl: { contains: "cyberjapandata2.gsi.go.jp/general/dem" } },
  });
  if (!source?.endpointUrl) {
    return NextResponse.json(
      { error: "not_found", message: "標高APIが台帳に登録されていません" },
      { status: 404 },
    );
  }

  const targetUrl = buildElevationUrl(source.endpointUrl, lat, lon);
  const result = await fetchWithGuard(targetUrl, { method: "GET", readBody: true });

  await prisma.fetchLog.create({
    data: {
      dataSourceId: source.id,
      executionType: "check",
      requestUrl: sanitizeUrl(targetUrl),
      method: "GET",
      statusCode: result.statusCode ?? null,
      success: result.success,
      responseTimeMs: result.responseTimeMs ?? null,
      responseSizeBytes: result.responseSizeBytes ?? null,
      contentType: result.contentType ?? null,
      errorType: result.errorType ?? null,
      errorMessage: result.errorMessage ?? null,
      note: "map: click elevation",
    },
  });

  if (!result.success) {
    return NextResponse.json(
      { success: false, errorType: result.errorType, message: result.errorMessage },
      { status: 502 },
    );
  }

  const parsed = parseElevationResponse(result.previewText ?? "");
  if (!parsed) {
    return NextResponse.json(
      { success: false, errorType: "parse_error", message: "標高APIのレスポンスを解釈できませんでした" },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, lat, lon, ...parsed });
}
