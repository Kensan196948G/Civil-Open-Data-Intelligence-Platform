import { describe, expect, it } from "vitest";

import { shouldSeedDemoData } from "../../prisma/seed-demo";

describe("shouldSeedDemoData", () => {
  it("requires both a non-production runtime and the demo identity flag", () => {
    expect(
      shouldSeedDemoData({ NODE_ENV: "development", CODIP_DEMO_IDENTITY: "true" }),
    ).toBe(true);
    expect(shouldSeedDemoData({ NODE_ENV: "test", CODIP_DEMO_IDENTITY: "TRUE" })).toBe(true);
  });

  it("refuses in production even when the demo identity flag is set", () => {
    expect(
      shouldSeedDemoData({ NODE_ENV: "production", CODIP_DEMO_IDENTITY: "true" }),
    ).toBe(false);
  });

  it("refuses when the opt-in flag is missing or false", () => {
    expect(shouldSeedDemoData({ NODE_ENV: "development" })).toBe(false);
    expect(
      shouldSeedDemoData({ NODE_ENV: "development", CODIP_DEMO_IDENTITY: "false" }),
    ).toBe(false);
  });
});
