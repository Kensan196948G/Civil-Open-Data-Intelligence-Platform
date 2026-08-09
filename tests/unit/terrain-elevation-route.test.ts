import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UpstreamTileError } from "@/lib/terrain/adapters";

const mocks = vi.hoisted(() => ({
  lookupElevation: vi.fn(),
}));

vi.mock("@/lib/terrain/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/terrain/adapters")>();
  return {
    ...actual,
    lookupElevation: mocks.lookupElevation,
  };
});

import { GET } from "@/app/api/v1/terrain/elevation/route";

function requestFor(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/terrain/elevation?${query}`);
}

describe("GET /api/v1/terrain/elevation", () => {
  it("returns elevation with quality and provenance", async () => {
    mocks.lookupElevation.mockResolvedValue({
      elevationM: 12.5,
      source: "DEM5C",
      coverage: "FULL",
      attempted: ["DEM5A", "DEM5B", "DEM5C"],
      provenance: [
        {
          sourceId: "gsi_dem5c_png",
          sourceName: "国土地理院 標高タイル DEM5C",
          sourceUrl: "https://cyberjapandata.gsi.go.jp/xyz/dem5c_png/15/x/y.png",
          termsUrl: "https://maps.gsi.go.jp/development/ichiran.html",
          retrievedAt: "2026-07-24T00:00:00.000Z",
          resolutionM: 5,
          processed: true,
          processingNote: "decoded",
        },
      ],
    });

    const response = await GET(requestFor("lat=35.681236&lon=139.767125"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.elevationM).toBe(12.5);
    expect(body.data.source).toBe("DEM5C");
    expect(body.data.quality.grade).toBe("C");
    expect(body.data.provenance[0].sourceId).toBe("gsi_dem5c_png");
    expect(body.warnings.some((w: { code: string }) => w.code === "decision_not_supported")).toBe(true);
  });

  it("rejects invalid coordinates with 400", async () => {
    const response = await GET(requestFor("lat=999&lon=0"));
    expect(response.status).toBe(400);
  });

  it("returns 404 when no coverage", async () => {
    mocks.lookupElevation.mockResolvedValue({
      elevationM: null,
      source: null,
      coverage: "NONE",
      attempted: ["DEM5A", "DEM5B", "DEM5C", "DEM10B"],
      provenance: [],
    });
    const response = await GET(requestFor("lat=35&lon=139"));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("no_coverage");
  });

  it("returns 503 when upstream failed", async () => {
    mocks.lookupElevation.mockRejectedValue(new UpstreamTileError("upstream 500", ["DEM5A"]));
    const response = await GET(requestFor("lat=35&lon=139"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("upstream_unavailable");
  });
});
