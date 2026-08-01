import { describe, expect, it } from "vitest";

import {
  databaseProviderFromUrl,
  isPostgreSqlDatabase,
  isPostgreSqlRuntime,
} from "@/lib/database-url";

describe("databaseProviderFromUrl", () => {
  it("detects PostgreSQL URLs", () => {
    expect(databaseProviderFromUrl("postgresql://user:pass@example.com/db")).toBe("postgresql");
    expect(databaseProviderFromUrl("postgres://user:pass@example.com/db")).toBe("postgresql");
    expect(isPostgreSqlDatabase("postgresql://user:pass@example.com/db")).toBe(true);
  });

  it("defaults to SQLite for file URLs and empty values", () => {
    expect(databaseProviderFromUrl("file:./dev.db")).toBe("sqlite");
    expect(databaseProviderFromUrl("")).toBe("sqlite");
    expect(isPostgreSqlDatabase("file:./dev.db")).toBe(false);
  });

  it("treats Cloudflare staging and production deploy targets as PostgreSQL runtimes", () => {
    expect(isPostgreSqlRuntime({ databaseUrl: "", deployTarget: "production" })).toBe(true);
    expect(isPostgreSqlRuntime({ databaseUrl: "", deployTarget: "staging" })).toBe(true);
    expect(isPostgreSqlRuntime({ databaseUrl: "", deployTarget: "" })).toBe(false);
    expect(isPostgreSqlRuntime({ databaseUrl: "file:./dev.db", deployTarget: "preview" })).toBe(false);
    expect(isPostgreSqlRuntime({ databaseUrl: "file:./dev.db", deployTarget: "production" })).toBe(false);
  });
});
