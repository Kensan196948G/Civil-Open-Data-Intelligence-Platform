import { describe, expect, it } from "vitest";
import { dataSourceCreateSchema, tagCreateSchema } from "@/lib/validators";

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
