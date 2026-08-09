import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

beforeAll(() => {
  process.env.CODIP_ADMIN_TOKEN = "test-admin-token-12345678901234567890";
  process.env.CODIP_ALLOW_INSECURE_ADMIN = "true";
});

import { GET as forecastGET } from "@/app/api/v1/weather/forecast/route";
import { GET as aiGET } from "@/app/api/v1/weather/ai-analysis/route";
import { POST as etlPOST } from "@/app/api/v1/etl/run/[id]/route";
import { POST as runsPOST } from "@/app/api/v1/terrain/runs/route";

describe("weather/forecast", () => {
  it("rejects invalid coordinates with 400", async () => {
    const response = await forecastGET(new NextRequest("http://localhost/api/v1/weather/forecast?lat=999&lon=0"));
    expect(response.status).toBe(400);
  });
});

describe("weather/ai-analysis", () => {
  it("requires siteId", async () => {
    const response = await aiGET(new NextRequest("http://localhost/api/v1/weather/ai-analysis"));
    expect(response.status).toBe(400);
  });
});

describe("etl/run", () => {
  it("rejects unknown job id with 404", async () => {
    const response = await etlPOST(new NextRequest("http://localhost/api/v1/etl/run/99"), {
      params: Promise.resolve({ id: "99" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("terrain/runs", () => {
  it("rejects invalid payload with 400", async () => {
    const request = new NextRequest("http://localhost/api/v1/terrain/runs", {
      method: "POST",
      body: JSON.stringify({ lat: 999, lon: 0, tab: "terrain", payload: {} }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await runsPOST(request);
    expect(response.status).toBe(400);
  });
});
