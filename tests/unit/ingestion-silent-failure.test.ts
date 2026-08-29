import { describe, expect, it, vi } from "vitest";
import { parsePayload, runIngestionJob } from "@/lib/ingestion/engine";

/**
 * 取得パイプラインの「無言の失敗」に対する回帰テスト。
 *
 * 最悪の障害は落ちる障害ではなく、成功として記録される障害である。
 * 提供元が WAF ブロックページやメンテナンス告知を HTTP 200 + text/html で返す、
 * あるいは列名を変更した場合、従来はどちらも status:"success" / inserted:0 で
 * 完走し、retryCount が 0 に戻り lastStatus も success になっていた。
 * 監視・鮮度スコア・SLA のすべてが「正常」を報告し続ける状態になる。
 */

function mockPrisma() {
  return {
    ingestionJob: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    ingestionRun: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    standardRecord: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

const dataSource = {
  id: "src_1",
  name: "CSVテストデータ",
  category: "road",
  endpointUrl: "https://example.com/data.csv",
  officialUrl: "https://example.com/",
};

function bodyStream(text: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function setupJob(prisma: ReturnType<typeof mockPrisma>) {
  prisma.ingestionJob.findUnique.mockResolvedValue({
    id: "job_1",
    etag: null,
    lastModified: null,
    retryCount: 0,
    maxRetries: 3,
    maxRecords: 500,
    intervalMinutes: 60,
    dataSource,
  });
  prisma.ingestionRun.create.mockResolvedValue({ id: "run_1" });
  prisma.ingestionRun.findFirst.mockResolvedValue(null);
  prisma.standardRecord.findFirst.mockResolvedValue(null);
  prisma.standardRecord.create.mockResolvedValue({ id: "std_1" });
  prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
  prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
}

/** parsePayload が要求する最小の source 形（name / category は必須）。 */
const src = (dataFormat: string) => ({ name: "テストソース", category: "road", dataFormat });

describe("parsePayload が HTML を CSV と誤判定しない", () => {
  // 旧実装の文字クラス [^"{[\s] は `<` を除外しておらず、1行目にカンマを含む
  // ミニファイ HTML が CSV として通っていた。
  it("1行目にカンマを含むミニファイHTMLを拒否する", () => {
    const html = "<html><head><title>Access Denied</title></head><body>Blocked, contact support</body></html>";
    expect(() => parsePayload(html, "text/html", src("CSV"))).toThrow(/HTML/);
    // Content-Type が当てにならない場合でも本文の形で弾く
    expect(() => parsePayload(html, "application/octet-stream", src("CSV"))).toThrow(/HTML/);
    expect(() => parsePayload(html, "", src("CSV"))).toThrow(/HTML/);
  });

  it("DOCTYPE から始まるページを拒否する", () => {
    const html = "<!DOCTYPE html><html><body>x, y</body></html>";
    expect(() => parsePayload(html, "", src("CSV"))).toThrow(/HTML/);
  });

  it("正規の CSV / JSON は従来どおり通す（過剰な拒否をしない）", () => {
    const csv = "title,lat,lng\n避難所A,35.6,139.7";
    expect(parsePayload(csv, "text/csv", src("CSV"))).toHaveLength(1);
    expect(parsePayload(csv, "", src("CSV"))).toHaveLength(1);
    expect(parsePayload('[{"title":"A","lat":35.6,"lng":139.7}]', "application/json", src("JSON"))).toHaveLength(1);
  });

  // XML は HTML 判定より前に分岐する。空 feed が別の理由で落ちるのは既存仕様なので、
  // ここで測るのは「HTML として拒否されていないこと」だけに限定する。
  it("XML(気象庁Atom feed) は HTML 判定に巻き込まれない", () => {
    const atom = '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
    expect(() => parsePayload(atom, "application/xml", src("XML"))).not.toThrow(/HTML/);
    // dataFormat が XML なら Content-Type が無くても XML 経路へ入る
    expect(() => parsePayload(atom, "", src("XML"))).not.toThrow(/HTML/);
  });
});

describe("HTML を返す提供元は success として記録されない", () => {
  it("HTTP 200 + text/html は dead_letter になる", async () => {
    const prisma = mockPrisma();
    setupJob(prisma);
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      body: bodyStream("<html><body>Service unavailable, try later</body></html>"),
    });

    const result = await runIngestionJob(prisma as never, {
      jobId: "job_1",
      triggeredBy: "test",
      now: new Date("2026-08-22T00:00:00.000Z"),
      fetchImpl,
    });

    expect(result.status).toBe("dead_letter");
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: "dead_letter" }) }),
    );
    // 成功として記録されていないこと（retryCount が 0 に戻らない）
    expect(prisma.ingestionJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: "success" }) }),
    );
  });
});

describe("取得できたのに全件スキップは success ではない", () => {
  it("title も座標も取り出せない CSV は dead_letter になる", async () => {
    const prisma = mockPrisma();
    setupJob(prisma);
    // 構造としては CSV だが、期待する列（title/lat/lng/address）が1つも無い。
    // 提供元が列名を変更した場合に起きる形。
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "text/csv"]]),
      body: bodyStream("col_a,col_b,col_c\n1,2,3\n4,5,6\n"),
    });

    const result = await runIngestionJob(prisma as never, {
      jobId: "job_1",
      triggeredBy: "test",
      now: new Date("2026-08-22T00:00:00.000Z"),
      fetchImpl,
    });

    expect(result.status).toBe("dead_letter");
    expect(result.inserted).toBe(0);
    expect(prisma.standardRecord.create).not.toHaveBeenCalled();
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: "dead_letter" }) }),
    );
  });

  it("1件でも取り込めていれば従来どおり success（過剰な dead_letter にしない）", async () => {
    const prisma = mockPrisma();
    setupJob(prisma);
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "text/csv"]]),
      body: bodyStream("title,address,lat,lng\n横浜地点,神奈川県,35.44,139.64\n,,,\n"),
    });

    const result = await runIngestionJob(prisma as never, {
      jobId: "job_1",
      triggeredBy: "test",
      now: new Date("2026-08-22T00:00:00.000Z"),
      fetchImpl,
    });

    expect(result.status).toBe("success");
    expect(result.inserted).toBe(1);
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: "success", retryCount: 0 }) }),
    );
  });
});
