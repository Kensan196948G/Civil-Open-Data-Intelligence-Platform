/**
 * 上限付きTTLキャッシュ。
 *
 * 素の Map + expiresAt 方式は「論理的に失効しても物理エントリが残る」ため、
 * キー空間が広い用途 (例: 緯度経度の組み合わせ) では長時間稼働プロセスの
 * ヒープが単調増加する (Issue #21)。本クラスは以下でそれを防ぐ:
 *
 * - get: 失効エントリはその場で削除して miss 扱い
 * - set: 上限到達時は失効エントリを先に掃除し、足りなければ挿入順の
 *   最古エントリから追い出す (Map の反復順 = 挿入順を利用)
 *
 * サイズは常に maxEntries 以下に保たれる。プロセス内キャッシュであり、
 * 複数インスタンス間では共有されない点は従来と同じ。
 */
export class TtlCache<V> {
  private store = new Map<string, { expiresAt: number; value: V }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("ttlMs must be a positive number");
    }
  }

  get(key: string, now: number = Date.now()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, now: number = Date.now()): void {
    // 再挿入で「最新」扱いにするため一度消す (挿入順が更新される)
    this.store.delete(key);

    if (this.store.size >= this.maxEntries) {
      // 1) 失効済みを先に掃除する
      for (const [k, entry] of this.store) {
        if (this.store.size < this.maxEntries) break;
        if (entry.expiresAt <= now) this.store.delete(k);
      }
      // 2) まだ満杯なら最古 (挿入順の先頭) から追い出す
      while (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) break;
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, { expiresAt: now + this.ttlMs, value });
  }

  get size(): number {
    return this.store.size;
  }
}
