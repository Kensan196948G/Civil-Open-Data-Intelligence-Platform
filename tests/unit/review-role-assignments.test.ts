import { describe, expect, it } from "vitest";
import { buildReport } from "../../scripts/tools/review-role-assignments";

const NOW = new Date("2026-08-12T00:00:00Z");

function assignment(expiresAt: Date | null) {
  return {
    id: "a1",
    userEmail: "u@example.com",
    scope: "global",
    expiresAt,
    role: { name: "engineer" },
  };
}

describe("review-role-assignments", () => {
  it("flags expired assignments", () => {
    const report = buildReport(
      [assignment(new Date("2026-08-01T00:00:00Z"))],
      NOW,
      14,
    );
    expect(report.expired.length).toBe(1);
    expect(report.ok).toBe(false);
  });

  it("flags assignments expiring within the window", () => {
    const report = buildReport(
      [assignment(new Date("2026-08-18T00:00:00Z"))],
      NOW,
      14,
    );
    expect(report.expiring.length).toBe(1);
    expect(report.ok).toBe(false);
  });

  it("accepts active assignments without expiry", () => {
    const report = buildReport([assignment(null)], NOW, 14);
    expect(report.rows[0].status).toBe("active");
    expect(report.ok).toBe(true);
  });
});
