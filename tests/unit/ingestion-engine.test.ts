import { describe, expect, it, vi } from "vitest";
import {
  dedupeKey,
  normalizeCoordinate,
  normalizeDate,
  normalizeNumber,
  parseCsv,
  parsePayload,
  runDueIngestionJobs,
  runIngestionJob,
  stopIngestionRun,
} from "@/lib/ingestion/engine";

function mockPrisma() {
  return {
    ingestionJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    ingestionRun: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    standardRecord: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

const dataSource = {
  id: "src_1",
  name: "CSVテストデータ",
  category: "road",
  endpointUrl: "https://example.com/data.csv",
  officialUrl: "https://example.com/",
};

describe("ingestion cleanse/parse helpers", () => {
  it("normalizes Japanese dates and numbers", () => {
    expect(normalizeDate("2026年8月5日")?.toISOString().slice(0, 10)).toBe("2026-08-05");
    expect(normalizeNumber("1,234円")).toBe(1234);
    expect(normalizeNumber("12.5%")).toBe(12.5);
  });

  it("converts web mercator coordinates into lng/lat", () => {
    const lng = normalizeCoordinate(15_558_791, "lng");
    const lat = normalizeCoordinate(4_325_555, "lat");
    expect(lng).not.toBeNull();
    expect(lat).not.toBeNull();
    if (lng != null && lat != null) {
      expect(Math.abs(lng - 139.767)).toBeLessThan(0.01);
      expect(Math.abs(lat - 36.181)).toBeLessThan(0.01);
    }
  });

  it("parses quoted CSV", () => {
    const rows = parseCsv('title,address,lat,lng\n"横浜, 中区",神奈川県,35.44,139.64\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("横浜, 中区");
    expect(rows[0].address).toBe("神奈川県");
  });

  it("parses GeoJSON payload into candidates", () => {
    const body = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [139.64, 35.44] },
          properties: { title: "地点A", category: "flood" },
        },
      ],
    });
    const candidates = parsePayload(body, "application/geo+json", dataSource);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("地点A");
    expect(candidates[0].lng).toBeCloseTo(139.64);
    expect(candidates[0].lat).toBeCloseTo(35.44);
  });

  it("produces stable dedupe keys", () => {
    expect(dedupeKey({ category: "road", title: "A", address: "横浜" })).toBe(
      dedupeKey({ category: "road", title: "A", address: "横浜" }),
    );
  });
});

describe("ingestion engine", () => {
  it("ingests CSV and upserts standard records with lineage", async () => {
    const prisma = mockPrisma();
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
    prisma.standardRecord.findFirst.mockResolvedValue(null);
    prisma.standardRecord.create.mockResolvedValue({ id: "std_1" });
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "text/csv"], ["etag", '"v1"']]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("title,address,lat,lng\n横浜地点,神奈川県,35.44,139.64\n"));
          controller.close();
        },
      }),
    });

    const result = await runIngestionJob(prisma as never, {
      jobId: "job_1",
      triggeredBy: "test",
      now: new Date("2026-08-05T00:00:00.000Z"),
      fetchImpl,
    });

    expect(result.status).toBe("success");
    expect(result.inserted).toBe(1);
    expect(prisma.standardRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dataSourceId: "src_1", ingestionRunId: "run_1" }),
      }),
    );
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastStatus: "success", retryCount: 0 }),
      }),
    );
  });

  it("skips when server returns 304 Not Modified", async () => {
    const prisma = mockPrisma();
    prisma.ingestionJob.findUnique.mockResolvedValue({
      id: "job_1",
      etag: '"v1"',
      lastModified: null,
      retryCount: 0,
      maxRetries: 3,
      maxRecords: 500,
      intervalMinutes: 60,
      dataSource,
    });
    prisma.ingestionRun.create.mockResolvedValue({ id: "run_1" });
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
    const fetchImpl = vi.fn().mockResolvedValue({ status: 304, headers: new Map() });

    const result = await runIngestionJob(prisma as never, { jobId: "job_1", fetchImpl });
    expect(result.status).toBe("skipped");
    expect(prisma.ingestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "skipped" }) }),
    );
  });

  it("records failure and increments retry count", async () => {
    const prisma = mockPrisma();
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
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
    const fetchImpl = vi.fn().mockResolvedValue({ status: 401, headers: new Map() });

    const result = await runIngestionJob(prisma as never, { jobId: "job_1", fetchImpl });
    expect(result.status).toBe("retrying");
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retryCount: 1, lastStatus: "retrying" }) }),
    );
  });

  it("moves exhausted retries into dead-letter queue", async () => {
    const prisma = mockPrisma();
    prisma.ingestionJob.findUnique.mockResolvedValue({
      id: "job_1",
      etag: null,
      lastModified: null,
      retryCount: 2,
      maxRetries: 3,
      maxRecords: 500,
      intervalMinutes: 60,
      dataSource,
    });
    prisma.ingestionRun.create.mockResolvedValue({ id: "run_1" });
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
    const fetchImpl = vi.fn().mockResolvedValue({ status: 503, headers: new Map() });

    const result = await runIngestionJob(prisma as never, { jobId: "job_1", fetchImpl });
    expect(result.status).toBe("dead_letter");
    expect(prisma.ingestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "dead_letter", deadLetterReason: "HTTP 503" }),
      }),
    );
  });

  it("respects provider-level rate limits", async () => {
    const prisma = mockPrisma();
    prisma.ingestionJob.findUnique.mockResolvedValue({
      id: "job_1",
      etag: null,
      lastModified: null,
      retryCount: 0,
      maxRetries: 3,
      maxRecords: 500,
      intervalMinutes: 60,
      dataSource: { ...dataSource, provider: { id: "provider_1", ingestionRateLimitMinutes: 60 } },
    });
    prisma.ingestionRun.findFirst.mockResolvedValue({
      id: "prev_run",
      startedAt: new Date(Date.now() - 10 * 60_000),
    });
    prisma.ingestionRun.create.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });

    const result = await runIngestionJob(prisma as never, { jobId: "job_1", fetchImpl: vi.fn() });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("provider_rate_limit");
    expect(prisma.ingestionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "skipped" }) }),
    );
  });

  it("flags schema changes against previous successful run", async () => {
    const prisma = mockPrisma();
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
    prisma.ingestionRun.findFirst.mockResolvedValue({
      id: "prev_run",
      schemaFingerprint: "different-fingerprint",
    });
    prisma.standardRecord.findFirst.mockResolvedValue(null);
    prisma.standardRecord.create.mockResolvedValue({ id: "std_1" });
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "application/json"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify([{ title: "A", address: "横浜", newField: "x" }])));
          controller.close();
        },
      }),
    });

    const result = await runIngestionJob(prisma as never, { jobId: "job_1", fetchImpl });
    expect(result.status).toBe("success");
    expect(prisma.ingestionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ schemaChanged: true, schemaFingerprint: expect.any(String) }),
      }),
    );
  });

  it("runs only due enabled jobs", async () => {
    const prisma = mockPrisma();
    prisma.ingestionJob.findMany.mockResolvedValue([
      {
        id: "job_1",
        dataSource,
      },
    ]);
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
    prisma.standardRecord.findFirst.mockResolvedValue(null);
    prisma.standardRecord.create.mockResolvedValue({ id: "std_1" });
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1" });
    prisma.ingestionJob.update.mockResolvedValue({ id: "job_1" });
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Map([["content-type", "application/json"]]),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify([{ title: "A", address: "横浜" }])));
          controller.close();
        },
      }),
    });

    const result = await runDueIngestionJobs(prisma as never, { maxJobs: 3, fetchImpl });
    expect(result.count).toBe(1);
    expect(prisma.ingestionJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("stops a running run", async () => {
    const prisma = mockPrisma();
    prisma.ingestionRun.findUnique.mockResolvedValue({ id: "run_1", status: "running" });
    prisma.ingestionRun.update.mockResolvedValue({ id: "run_1", status: "stopped" });
    const result = await stopIngestionRun(prisma as never, { runId: "run_1" });
    expect(result).toEqual({ status: "stopped", changed: true });
  });
});
