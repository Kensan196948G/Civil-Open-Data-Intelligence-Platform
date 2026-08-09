import { describe, expect, it } from "vitest";
import { buildCacheKey } from "@/lib/terrain/adapters";

describe("buildCacheKey", () => {
  it("formats the key as v1:{sourceKey}:{sourceVersion}:{z}:{x}:{y}:{normalizerVersion}", () => {
    const key = buildCacheKey({
      sourceKey: "gsi-dem",
      sourceVersion: "2024-01",
      z: 14,
      x: 14550,
      y: 6451,
      normalizerVersion: "n1",
    });
    expect(key).toBe("v1:gsi-dem:2024-01:14:14550:6451:n1");
  });

  it("produces distinct keys when the normalizer version changes", () => {
    const base = {
      sourceKey: "gsi-dem",
      sourceVersion: "2024-01",
      z: 14,
      x: 14550,
      y: 6451,
    } as const;
    expect(buildCacheKey({ ...base, normalizerVersion: "n1" })).not.toBe(
      buildCacheKey({ ...base, normalizerVersion: "n2" }),
    );
  });
});
