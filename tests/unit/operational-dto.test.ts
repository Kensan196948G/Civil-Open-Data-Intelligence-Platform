import { describe, expect, it } from "vitest";
import { redactOperationalText, safeFetchLogDto, safeSampleResponseDto } from "@/lib/operational-dto";

describe("operational dto safety", () => {
  it("masks secrets in operational text", () => {
    expect(
      redactOperationalText("failed https://example.com/?token=secret Authorization: Bearer abc.def"),
    ).toBe("failed https://example.com/?token=*** Authorization: Bearer ***");
  });

  it("masks JSON, YAML, and header-style secret values", () => {
    const redacted = redactOperationalText(
      '{"token":"raw-token","api_key": "raw-key"}\nclient_secret: raw-secret\nx-api-key: raw-header\nAuthorization: Basic dXNlcjpwYXNz',
    );

    expect(redacted).toContain('"token":"***"');
    expect(redacted).toContain('"api_key": "***"');
    expect(redacted).toContain("client_secret: ***");
    expect(redacted).toContain("x-api-key: ***");
    expect(redacted).toContain("Authorization: Basic ***");
    expect(redacted).not.toContain("raw-token");
    expect(redacted).not.toContain("raw-key");
    expect(redacted).not.toContain("raw-secret");
    expect(redacted).not.toContain("raw-header");
    expect(redacted).not.toContain("dXNlcjpwYXNz");
  });

  it("sanitizes fetch log URLs and errors on read", () => {
    const dto = safeFetchLogDto({
      id: "log_1",
      requestUrl: "https://user:pass@example.com/data?api_key=secret&x=1",
      errorMessage: "upstream returned client_secret=hidden",
    });

    expect(dto.requestUrl).toBe("https://example.com/data?api_key=***&x=1");
    expect(dto.errorMessage).toBe("upstream returned client_secret=***");
  });

  it("sanitizes sample previews on read", () => {
    const dto = safeSampleResponseDto({
      id: "sample_1",
      previewText: '{"next":"https://example.com/?token=raw","client_secret":"raw-secret"}',
    });

    expect(dto.previewText).toContain("token=***");
    expect(dto.previewText).toContain('"client_secret":"***"');
    expect(dto.previewText).not.toContain("token=raw");
    expect(dto.previewText).not.toContain("raw-secret");
  });
});
