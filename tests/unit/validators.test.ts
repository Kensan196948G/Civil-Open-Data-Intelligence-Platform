import { describe, expect, it } from "vitest";
import { dataSourceCreateSchema, dataSourceUpdateSchema, tagCreateSchema } from "@/lib/validators";

const validSource = {
  name: "国土数値情報",
  providerName: "国土交通省",
  officialUrl: "https://nlftp.mlit.go.jp/ksj/",
  category: "gis",
  dataFormat: "GeoJSON",
  accessType: "download",
  requiresApiKey: false,
};

describe("dataSourceCreateSchema", () => {
  it("正しい入力を受理する", () => {
    const result = dataSourceCreateSchema.safeParse(validSource);
    expect(result.success).toBe(true);
  });

  it("名称必須", () => {
    expect(dataSourceCreateSchema.safeParse({ ...validSource, name: "" }).success).toBe(false);
  });

  it("公式URLはURL形式必須", () => {
    expect(
      dataSourceCreateSchema.safeParse({ ...validSource, officialUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("公式URLと任意URLは http/https の公開URLのみ許可する", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "ftp://example.com/data.zip",
      "http://localhost:3000/data.json",
      "http://127.0.0.1/data.json",
      "http://10.0.0.1/data.json",
      "http://example.local/data.json",
    ]) {
      expect(dataSourceCreateSchema.safeParse({ ...validSource, officialUrl: url }).success).toBe(
        false,
      );
      expect(dataSourceCreateSchema.safeParse({ ...validSource, endpointUrl: url }).success).toBe(
        false,
      );
    }
  });

  it("URLにユーザー名・パスワードを含めない", () => {
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        officialUrl: "https://user:pass@example.com/data.json",
      }).success,
    ).toBe(false);
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        endpointUrl: "https://user:pass@example.com/api",
      }).success,
    ).toBe(false);
  });

  it("URLにAPIキー・トークン等の秘密系クエリを含めない", () => {
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        officialUrl: "https://example.com/data.json?token=secret",
      }).success,
    ).toBe(false);
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        endpointUrl: "https://api.example.com/data?api_key=secret",
      }).success,
    ).toBe(false);
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        documentationUrl: "https://docs.example.com/?appId=secret",
      }).success,
    ).toBe(false);
  });

  it("不正カテゴリを拒否する", () => {
    expect(
      dataSourceCreateSchema.safeParse({ ...validSource, category: "invalid" }).success,
    ).toBe(false);
  });

  it("信頼度は1〜5", () => {
    expect(dataSourceCreateSchema.safeParse({ ...validSource, trustLevel: 0 }).success).toBe(false);
    expect(dataSourceCreateSchema.safeParse({ ...validSource, trustLevel: 6 }).success).toBe(false);
    expect(dataSourceCreateSchema.safeParse({ ...validSource, trustLevel: 5 }).success).toBe(true);
  });

  it("品質スコアは0〜100", () => {
    expect(dataSourceCreateSchema.safeParse({ ...validSource, qualityScore: -1 }).success).toBe(false);
    expect(dataSourceCreateSchema.safeParse({ ...validSource, qualityScore: 101 }).success).toBe(false);
    expect(dataSourceCreateSchema.safeParse({ ...validSource, qualityScore: 100 }).success).toBe(true);
  });

  it("空文字の任意URLは null に変換される", () => {
    const result = dataSourceCreateSchema.parse({ ...validSource, endpointUrl: "" });
    expect(result.endpointUrl).toBeNull();
  });

  it("APIキー環境変数名は英大文字・数字・_のみ", () => {
    expect(
      dataSourceCreateSchema.safeParse({ ...validSource, apiKeyEnvName: "ESTAT_APP_ID" }).success,
    ).toBe(true);
    expect(
      dataSourceCreateSchema.safeParse({ ...validSource, apiKeyEnvName: "estat-app-id" }).success,
    ).toBe(false);
  });

  it("APIキー利用データソースはHTTPS URLのみ許可する", () => {
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        officialUrl: "http://example.com/open-data.json",
        requiresApiKey: true,
        apiKeyEnvName: "ESTAT_APP_ID",
      }).success,
    ).toBe(false);
    expect(
      dataSourceUpdateSchema.safeParse({
        officialUrl: "http://example.com/open-data.json",
        requiresApiKey: true,
        apiKeyEnvName: "ESTAT_APP_ID",
      }).success,
    ).toBe(false);
    expect(
      dataSourceCreateSchema.safeParse({
        ...validSource,
        endpointUrl: "https://api.example.com/open-data.json",
        requiresApiKey: true,
        apiKeyEnvName: "ESTAT_APP_ID",
      }).success,
    ).toBe(true);
  });

  it("boolean項目は true/false だけを明示的に解釈する", () => {
    expect(
      dataSourceCreateSchema.parse({
        ...validSource,
        requiresApiKey: "false",
        attributionRequired: "false",
      }),
    ).toMatchObject({
      requiresApiKey: false,
      attributionRequired: false,
    });
    expect(
      dataSourceCreateSchema.safeParse({ ...validSource, requiresApiKey: "yes" }).success,
    ).toBe(false);
    expect(
      dataSourceCreateSchema.safeParse({ ...validSource, attributionRequired: "0" }).success,
    ).toBe(false);
  });
});

describe("tagCreateSchema", () => {
  it("正しいタグを受理する", () => {
    expect(tagCreateSchema.safeParse({ name: "災害", color: "#dc2626" }).success).toBe(true);
  });

  it("タグ名必須", () => {
    expect(tagCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("不正な色形式を拒否する", () => {
    expect(tagCreateSchema.safeParse({ name: "災害", color: "red" }).success).toBe(false);
  });
});
