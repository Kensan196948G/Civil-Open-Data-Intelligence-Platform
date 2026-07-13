import { describe, expect, it } from "vitest";

import { databaseProviderFromUrl, isPostgreSqlDatabase } from "@/lib/database-url";

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
});
