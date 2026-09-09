import { describe, expect, it } from "vitest";
import { ACCESS_TYPES, CATEGORIES } from "@/lib/constants";
import { DEFAULT_ROLES, INITIAL_TAGS, PROVIDERS, SOURCES } from "../../prisma/seed-data";

/**
 * Data Quality テスト (Gate 2): 台帳シードの品質ポリシー。
 *
 * tests/unit/seed-data.test.ts が必須フィールド・URL 重複・provider 参照を
 * 担うため、ここでは未カバーの整合性軸を検証する:
 * schema (列挙値) / 重複 / 範囲 / 出典 (タグ・プロバイダ) / 不変条件。
 * docs/08-data-quality-policy.md の品質軸に対応する。
 */

const CATEGORY_VALUES = CATEGORIES.map((c) => c.value) as readonly string[];
const TAG_NAMES = new Set(INITIAL_TAGS.map((t) => t.name));

describe("seed data quality policy", () => {
  it("category は CATEGORIES 列挙値のみ (妥当性)", () => {
    for (const source of SOURCES) {
      expect(
        CATEGORY_VALUES.includes(source.category),
        `${source.name} category=${source.category}`,
      ).toBe(true);
    }
  });

  it("accessType は ACCESS_TYPES 列挙値のみ (妥当性)", () => {
    for (const source of SOURCES) {
      expect(ACCESS_TYPES as readonly string[]).toContain(source.accessType);
    }
  });

  it("endpointUrl は常に https (継続性・安全性)", () => {
    for (const source of SOURCES) {
      if (source.endpointUrl) {
        expect(source.endpointUrl.startsWith("https://"), source.name).toBe(true);
      }
    }
  });

  it("タグは INITIAL_TAGS に登録済みの名前のみ (出典性・整合性)", () => {
    for (const source of SOURCES) {
      for (const tag of source.tags) {
        expect(TAG_NAMES.has(tag), `${source.name} tag=${tag}`).toBe(true);
      }
    }
  });

  it("requiresApiKey なら apiKeyEnvName を持つ (不変条件)", () => {
    for (const source of SOURCES) {
      if (source.requiresApiKey) {
        expect(
          typeof source.apiKeyEnvName === "string" && source.apiKeyEnvName.length > 0,
          `${source.name} requiresApiKey なのに apiKeyEnvName がない`,
        ).toBe(true);
      }
    }
  });

  it("useCase が 1 件以上あり、名前が空でない (業務利用の記録)", () => {
    for (const source of SOURCES) {
      expect(source.useCases.length, `${source.name} useCases 0 件`).toBeGreaterThan(0);
      for (const useCase of source.useCases) {
        expect(useCase.useCaseName.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("(providerName, name) の組が重複しない (一意性)", () => {
    const seen = new Set<string>();
    for (const source of SOURCES) {
      const key = `${source.providerName}::${source.name}`;
      expect(seen.has(key), `重複: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("プロバイダは公式 URL を持ち、重複しない (出典性)", () => {
    const seen = new Set<string>();
    for (const provider of PROVIDERS) {
      expect(typeof provider.name === "string" && provider.name.length > 0).toBe(true);
      if ("officialUrl" in provider && typeof (provider as { officialUrl?: unknown }).officialUrl === "string") {
        const url = (provider as { officialUrl: string }).officialUrl;
        expect(url.startsWith("https://"), provider.name).toBe(true);
        expect(seen.has(url), `provider officialUrl 重複: ${url}`).toBe(false);
        seen.add(url);
      }
    }
  });

  it("INITIAL_TAGS は名前が一意で色は #RRGGBB (UI 整合性)", () => {
    const names = new Set<string>();
    for (const tag of INITIAL_TAGS) {
      expect(names.has(tag.name), `タグ名重複: ${tag.name}`).toBe(false);
      names.add(tag.name);
      expect(tag.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("DEFAULT_ROLES は priority が一意で admin が最上位 (RBAC 前提)", () => {
    const priorities = DEFAULT_ROLES.map((r) => r.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
    const admin = DEFAULT_ROLES.find((r) => r.name === "admin");
    expect(admin?.priority).toBe(Math.max(...priorities));
  });
});
