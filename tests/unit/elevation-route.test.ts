import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

const dataSourceFindManyMock = vi.hoisted(() => vi.fn());
const fetchLogCreateMock = vi.hoisted(() => vi.fn());
const fetchWithGuardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    dataSource: {
      findMany: dataSourceFindManyMock,
    },
    fetchLog: {
      create: fetchLogCreateMock,
    },
  },
}));

vi.mock("@/lib/http-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http-client")>("@/lib/http-client");
  return {
    ...actual,
    fetchWithGuard: fetchWithGuardMock,
  };
});

import { GET as elevationGET } from "@/app/api/map/elevation/route";

const validEndpoint =
  "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=140.08531&lat=36.103543&outtype=JSON";

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitForTests();
});

describe("map elevation route", () => {
  it("rejects spoofed GSI endpoint candidates instead of proxying arbitrary public URLs", async () => {
    dataSourceFindManyMock.mockResolvedValueOnce([
      {
        id: "src_spoof",
        endpointUrl: "https://evil.example/general/dem/scripts/getelevation.php?next=cyberjapandata2.gsi.go.jp",
      },
    ]);

    const response = await elevationGET(new NextRequest("http://localhost/api/map/elevation?lat=35&lon=139"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(fetchWithGuardMock).not.toHaveBeenCalled();
    expect(fetchLogCreateMock).not.toHaveBeenCalled();
  });

  it("fetches only a strict GSI elevation endpoint and logs the request", async () => {
    dataSourceFindManyMock.mockResolvedValueOnce([
      { id: "src_valid", endpointUrl: validEndpoint },
    ]);
    fetchWithGuardMock.mockResolvedValueOnce({
      success: true,
      statusCode: 200,
      responseTimeMs: 12,
      responseSizeBytes: 32,
      contentType: "application/json",
      previewText: '{"elevation":12.3,"hsrc":"5m"}',
      finalUrl: validEndpoint,
    });
    fetchLogCreateMock.mockResolvedValueOnce({});

    const response = await elevationGET(new NextRequest("http://localhost/api/map/elevation?lat=35&lon=139"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, lat: 35, lon: 139, elevation: 12.3 });
    expect(fetchWithGuardMock).toHaveBeenCalledWith(
      expect.stringContaining("https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php"),
      { method: "GET", readBody: true },
    );
    expect(fetchLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataSourceId: "src_valid",
          success: true,
        }),
      }),
    );
  });
});
