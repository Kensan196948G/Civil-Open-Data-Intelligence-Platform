import { describe, expect, it } from "vitest";
import {
  MAX_OBSERVATION_BATCH,
  validateObservationBatch,
} from "@/lib/observation-batch";

/**
 * 観測値一括登録の入力サイズ制約 (POST /api/v1/observations/{weather,marine})。
 *
 * GET 側は limit に 1〜2000 の上限があるのに、POST 側の配列長には上限が無く、
 * 検証は「非空の配列であること」だけだった。その後 1 要素ずつ逐次 upsert するため、
 * 1 リクエストで数万件の DB ラウンドトリップを発生させ接続を占有できた。
 * レート制限 (1分30リクエスト) はリクエスト数を縛るもので、1 リクエストの重さは
 * 縛らない。
 */
describe("validateObservationBatch", () => {
  const row = { siteId: "site-1", observedAt: "2026-09-09T00:00:00Z" };

  it("配列でない入力を拒否する", () => {
    for (const invalid of [null, undefined, {}, "rows", 42]) {
      const result = validateObservationBatch(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("invalid_query");
    }
  });

  it("空配列を拒否する", () => {
    const result = validateObservationBatch([]);
    expect(result.ok).toBe(false);
  });

  it("上限ちょうどは受け付ける", () => {
    const result = validateObservationBatch(Array.from({ length: MAX_OBSERVATION_BATCH }, () => row));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(MAX_OBSERVATION_BATCH);
  });

  it("上限を1件でも超えたら拒否し、件数を伝える", () => {
    const oversized = Array.from({ length: MAX_OBSERVATION_BATCH + 1 }, () => row);
    const result = validateObservationBatch(oversized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_query");
      // 何件送ったから弾かれたのかが分からないと、呼び出し側は分割量を決められない。
      expect(result.error.message).toContain(String(MAX_OBSERVATION_BATCH));
      expect(result.error.message).toContain(String(MAX_OBSERVATION_BATCH + 1));
    }
  });

  it("上限は有限で、GET 側の limit 上限を超えない", () => {
    expect(Number.isFinite(MAX_OBSERVATION_BATCH)).toBe(true);
    expect(MAX_OBSERVATION_BATCH).toBeGreaterThan(0);
    expect(MAX_OBSERVATION_BATCH).toBeLessThanOrEqual(2000);
  });
});
