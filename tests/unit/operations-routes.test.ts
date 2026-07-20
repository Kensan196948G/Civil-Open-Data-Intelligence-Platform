import { describe, expect, it, vi } from "vitest";

const queryRawMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: queryRawMock,
  },
}));

import { GET as healthGET } from "@/app/api/health/route";
import { GET as openApiGET } from "@/app/api/openapi/route";
import { GET as readyGET } from "@/app/api/ready/route";

const adminSecurity = [{ adminToken: [] }, { adminSession: [] }, { adminProxy: [] }];

describe("operations API routes", () => {
  it("returns liveness without database access", async () => {
    const response = await healthGET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      service: "civil-open-data-intelligence-platform",
    });
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("returns ready when the database responds", async () => {
    queryRawMock.mockResolvedValueOnce([{ ok: 1 }]);

    const response = await readyGET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      service: "civil-open-data-intelligence-platform",
      checks: { database: "ok" },
    });
  });

  it("returns 503 when readiness dependencies fail", async () => {
    queryRawMock.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await readyGET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "not_ready",
      checks: { database: "error" },
      error: "readiness_dependency_failed",
    });
    expect(JSON.stringify(body)).not.toContain("database unavailable");
  });

  it("publishes the OpenAPI contract for monitoring and downstream systems", async () => {
    const response = await openApiGET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("CODIP API");
    expect(body.paths["/api/health"].get.tags).toContain("operations");
    expect(body.paths["/api/ready"].get.responses["503"]).toBeDefined();
    expect(body.paths["/api/admin/session"].get.tags).toContain("admin");
    expect(body.paths["/api/admin/session"].post.responses["403"].description).toContain("CSRF");
    expect(body.paths["/api/tags"].get.tags).toContain("catalog");
    expect(body.paths["/api/tags"].get.responses["429"].description).toContain("レート制限");
    expect(body.paths["/api/tags"].post.security).toEqual(adminSecurity);
    expect(body.paths["/api/tags/{id}"].delete.security).toEqual(adminSecurity);
    expect(body.paths["/api/admin/settings"].get.security).toEqual(adminSecurity);
    expect(body.paths["/api/admin/settings"].get.responses["401"].description).toContain("管理認証");
    expect(body.paths["/api/admin/settings"].get.responses["503"].description).toContain("管理ガード");
    expect(body.paths["/api/admin/settings"].get.responses["403"]).toBeUndefined();
    expect(body.paths["/api/v1/records/search"].get.tags).toContain("downstream");
    expect(body.paths["/api/v1/records/point"].get.tags).toContain("downstream");
    expect(body.paths["/api/v1/sources/{id}/freshness"].get.tags).toContain("downstream");
    expect(body.paths["/api/v1/layers"].get.tags).toContain("downstream");
    expect(body.paths["/api/v1/layers/{id}/features"].get.tags).toContain("downstream");
    expect(body.components.schemas.V1ErrorResponse).toBeDefined();
    expect(body.components.schemas.V1StandardRecord.required).toContain("recordId");
    expect(body.components.schemas.V1StandardRecord.required).toContain("qualityStatus");
    expect(body.components.schemas.V1Warning.required).toEqual(["code", "severity", "message"]);
    expect(body.components.schemas.V1Meta.required).toContain("requestId");
    expect(
      body.paths["/api/v1/records/search"].get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/V1RecordsSearchResponse");
    expect(
      body.components.schemas.V1RecordsSearchResponse.properties.data.properties.records.items.$ref,
    ).toBe("#/components/schemas/V1StandardRecord");
    expect(
      body.paths["/api/v1/records/search"].get.responses["429"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/V1ErrorResponse");
    expect(
      body.paths["/api/v1/layers/{id}/features"].get.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/V1FeatureCollectionResponse");
    expect(body.paths["/api/fetch-logs"].get.security).toEqual(adminSecurity);
    expect(body.paths["/api/fetch-logs"].get.responses["401"].description).toContain("管理認証");
    expect(body.paths["/api/fetch-logs"].get.responses["429"].description).toContain("レート制限");
    expect(body.paths["/api/fetch-logs"].get.responses["503"].description).toContain("管理ガード");
    expect(body.components.securitySchemes.adminToken.name).toBe("x-codip-admin-token");
    expect(body.components.securitySchemes.adminSession.in).toBe("cookie");
    expect(body.components.securitySchemes.adminProxy.name).toBe("x-codip-proxy-secret");
  });
});
