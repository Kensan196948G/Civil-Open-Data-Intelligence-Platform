import { describe, expect, it } from "vitest";
import { buildNotifications, jobFreshness } from "../../scripts/ingestion/notification-check";

const NOW = new Date("2026-08-12T03:00:00Z");

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `job-${id}`,
    enabled: true,
    dataSourceId: `ds-${id}`,
    lastRunAt: new Date("2026-08-11T03:00:00Z"),
    lastStatus: "success",
    retryCount: 0,
    maxRetries: 3,
    dataSource: {
      name: `source-${id}`,
      updateFrequency: "daily",
      provider: { name: "気象庁" },
    },
    ...overrides,
  };
}

describe("notification-check", () => {
  it("flags stale jobs watched by a user", () => {
    const digest = buildNotifications(
      [
        {
          id: "w1",
          userEmail: "user@example.com",
          targetType: "dataSource",
          targetId: "ds-j1",
          enabled: true,
        },
      ],
      [job("j1", { lastRunAt: new Date("2026-08-01T03:00:00Z") })],
      [],
      NOW,
    );
    expect(digest[0].userEmail).toBe("user@example.com");
    expect(digest[0].notifications[0].state).toBe("stale");
  });

  it("flags failed jobs", () => {
    const digest = buildNotifications(
      [
        {
          id: "w2",
          userEmail: "user@example.com",
          targetType: "ingestionJob",
          targetId: "j2",
          enabled: true,
        },
      ],
      [job("j2", { lastStatus: "failed", retryCount: 3 })],
      [],
      NOW,
    );
    expect(digest[0].notifications[0].state).toBe("failed");
  });

  it("flags caution/stop decisions for watched sites", () => {
    const digest = buildNotifications(
      [
        {
          id: "w3",
          userEmail: "user@example.com",
          targetType: "site",
          targetId: "site-1",
          enabled: true,
        },
      ],
      [],
      [{ siteId: "site-1", status: "stop", generatedAt: new Date("2026-08-12T02:00:00Z") }],
      NOW,
    );
    expect(digest[0].notifications[0].state).toBe("stop");
  });

  it("does not notify for fresh jobs and go decisions", () => {
    const digest = buildNotifications(
      [
        {
          id: "w4",
          userEmail: "user@example.com",
          targetType: "site",
          targetId: "site-2",
          enabled: true,
        },
      ],
      [job("j3")],
      [{ siteId: "site-2", status: "go", generatedAt: new Date("2026-08-12T02:00:00Z") }],
      NOW,
    );
    expect(digest.length).toBe(0);
  });

  it("computes job freshness", () => {
    expect(jobFreshness(job("j1"), NOW).state).toBe("ok");
    expect(jobFreshness(job("j1", { lastRunAt: null }), NOW).state).toBe("never-run");
  });
});
