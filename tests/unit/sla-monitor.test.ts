import { describe, expect, it } from "vitest";
import { buildReport, evaluateJob } from "../../scripts/ingestion/sla-monitor";

const NOW = new Date("2026-08-12T03:00:00Z");

function job(overrides: Record<string, unknown>) {
  return {
    id: "j1",
    name: "test job",
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    dataSource: {
      updateFrequency: "daily",
      provider: { name: "気象庁" },
    },
    ...overrides,
  };
}

describe("sla-monitor", () => {
  it("marks a fresh daily job as ok", () => {
    const result = evaluateJob(job({ lastRunAt: new Date("2026-08-11T03:00:00Z") }), NOW);
    expect(result.sla).toBe("ok");
  });

  it("marks a job older than its frequency as stale", () => {
    const result = evaluateJob(job({ lastRunAt: new Date("2026-08-01T03:00:00Z") }), NOW);
    expect(result.sla).toBe("stale");
  });

  it("marks an enabled job that never ran", () => {
    const result = evaluateJob(job({ lastRunAt: null }), NOW);
    expect(result.sla).toBe("never-run");
  });

  it("does not track irregular frequencies", () => {
    const result = evaluateJob(
      job({ dataSource: { updateFrequency: "irregular", provider: { name: "x" } } }),
      NOW,
    );
    expect(result.sla).toBe("not-tracked");
  });

  it("aggregates by provider and reports stale jobs", () => {
    const report = buildReport(
      [
        job({ id: "a", name: "stale-a", lastRunAt: new Date("2026-08-01T03:00:00Z") }),
        job({ id: "b", name: "ok-b", lastRunAt: new Date("2026-08-11T03:00:00Z") }),
      ],
      NOW,
    );
    expect(report.byProvider.get("気象庁")).toMatchObject({ ok: 1, stale: 1 });
    expect(report.ok).toBe(false);
  });
});
