import { describe, expect, it } from "vitest";
import { TtlCache } from "@/lib/ttl-cache";

describe("TtlCache", () => {
  it("保存した値をTTL内は返す", () => {
    const cache = new TtlCache<string>(10, 1000);
    cache.set("a", "value-a", 0);
    expect(cache.get("a", 999)).toBe("value-a");
  });

  it("TTLを過ぎた値はmissになり、エントリも物理削除される", () => {
    const cache = new TtlCache<string>(10, 1000);
    cache.set("a", "value-a", 0);
    expect(cache.get("a", 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("上限を超えるsetでも size が maxEntries を超えない (Issue #21 の回帰)", () => {
    const cache = new TtlCache<number>(5, 10_000);
    for (let i = 0; i < 100; i++) {
      cache.set(`key-${i}`, i, 0);
    }
    expect(cache.size).toBeLessThanOrEqual(5);
    // 直近に入れたものは生きている
    expect(cache.get("key-99", 1)).toBe(99);
  });

  it("上限到達時は失効エントリを先に追い出す", () => {
    const cache = new TtlCache<string>(2, 1000);
    cache.set("expired", "old", 0); // expires at 1000
    cache.set("alive", "fresh", 500); // expires at 1500
    // now=1200: "expired" は失効済み。上限2のところへ3件目を入れる
    cache.set("new", "newest", 1200);
    expect(cache.size).toBe(2);
    expect(cache.get("alive", 1200)).toBe("fresh"); // 生存エントリは残る
    expect(cache.get("new", 1200)).toBe("newest");
    expect(cache.get("expired", 1200)).toBeUndefined();
  });

  it("全て生存している場合は最古の挿入から追い出す", () => {
    const cache = new TtlCache<string>(2, 10_000);
    cache.set("first", "1", 0);
    cache.set("second", "2", 1);
    cache.set("third", "3", 2);
    expect(cache.get("first", 3)).toBeUndefined(); // 最古が追い出される
    expect(cache.get("second", 3)).toBe("2");
    expect(cache.get("third", 3)).toBe("3");
  });

  it("同一キーの再setはエントリ数を増やさず、値とTTLを更新する", () => {
    const cache = new TtlCache<string>(3, 1000);
    cache.set("a", "v1", 0);
    cache.set("a", "v2", 500);
    expect(cache.size).toBe(1);
    expect(cache.get("a", 1400)).toBe("v2"); // v1のTTL(1000)は過ぎたが再setで延長済み
  });

  it("不正なコンストラクタ引数を拒否する", () => {
    expect(() => new TtlCache(0, 1000)).toThrow();
    expect(() => new TtlCache(10, 0)).toThrow();
    expect(() => new TtlCache(1.5, 1000)).toThrow();
  });
});
