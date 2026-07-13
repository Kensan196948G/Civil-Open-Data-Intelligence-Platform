import { describe, expect, it } from "vitest";
import { safeSourceDto } from "@/lib/source-dto";

const source = {
  id: "src_1",
  providerId: "provider_1",
  name: "Secret URL Source",
  nameEn: null,
  description: "test",
  officialUrl: "https://user:pass@example.com/data?token=secret&lat=35",
  endpointUrl: "https://api.example.com/items?api_key=secret",
  documentationUrl: "https://docs.example.com/?appId=secret",
  category: "gis",
  dataFormat: "GeoJSON",
  accessType: "api",
  requiresApiKey: true,
  apiKeyEnvName: "SECRET_API_KEY",
  licenseName: "license",
  commercialUse: "allowed",
  attributionRequired: true,
  updateFrequency: "daily",
  lastCheckedAt: new Date("2026-07-01T00:00:00.000Z"),
  status: "active",
  trustLevel: 5,
  qualityScore: 90,
  note: "internal memo",
  updatedBy: "admin",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  provider: {
    id: "provider_1",
    name: "Provider",
    organizationType: "national",
    officialUrl: "https://provider.example.com/?key=secret",
  },
  tags: [{ tag: { id: "tag_1", name: "GIS", color: "#2563eb" } }],
};

describe("safeSourceDto", () => {
  it("masks URL secrets and removes internal operational fields by default", () => {
    const dto = safeSourceDto(source);

    expect(dto.officialUrl).toBe("https://example.com/data?token=***&lat=35");
    expect(dto.endpointUrl).toBe("https://api.example.com/items?api_key=***");
    expect(dto.documentationUrl).toBe("https://docs.example.com/?appId=***");
    expect(dto.provider?.officialUrl).toBe("https://provider.example.com/?key=***");
    expect(dto).not.toHaveProperty("apiKeyEnvName");
    expect(dto).not.toHaveProperty("note");
    expect(dto).not.toHaveProperty("updatedBy");
  });

  it("keeps internal fields for authenticated management responses while masking URLs", () => {
    const dto = safeSourceDto(source, { includeSensitive: true }) as Record<string, unknown>;

    expect(dto.apiKeyEnvName).toBe("SECRET_API_KEY");
    expect(dto.note).toBe("internal memo");
    expect(dto.updatedBy).toBe("admin");
    expect(String(dto.officialUrl)).toContain("token=***");
  });
});
