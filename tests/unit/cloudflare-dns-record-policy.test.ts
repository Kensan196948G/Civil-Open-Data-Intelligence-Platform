import { describe, expect, it } from "vitest";

const { planWorkerRouteDnsRecord } = await import("../../scripts/deploy/cloudflare-dns-record-policy.mjs");

describe("cloudflare DNS record policy", () => {
  it("creates the Worker route placeholder record when no DNS record exists", () => {
    const plan = planWorkerRouteDnsRecord([], "civilopendata.mirai-dx-platform.com");

    expect(plan.action).toBe("create");
    expect(plan.message).toContain("AAAA 100::");
  });

  it("reuses an existing proxied AAAA 100:: Worker route placeholder", () => {
    const record = { type: "AAAA", content: "100::", proxied: true };
    const plan = planWorkerRouteDnsRecord([record], "civilopendata.mirai-dx-platform.com");

    expect(plan.action).toBe("reuse");
    expect(plan.record).toBe(record);
  });

  it("blocks deploy when an existing record would route traffic to an origin", () => {
    const plan = planWorkerRouteDnsRecord(
      [{ type: "A", content: "203.0.113.10", proxied: true }],
      "civilopendata.mirai-dx-platform.com",
    );

    expect(plan.action).toBe("block");
    expect(plan.message).toContain("not the expected Worker route placeholder");
    expect(plan.message).toContain("A 203.0.113.10");
  });

  it("blocks deploy when the placeholder record is DNS-only", () => {
    const plan = planWorkerRouteDnsRecord(
      [{ type: "AAAA", content: "100::", proxied: false }],
      "civilopendata.mirai-dx-platform.com",
    );

    expect(plan.action).toBe("block");
    expect(plan.message).toContain("proxied=false");
  });
});
