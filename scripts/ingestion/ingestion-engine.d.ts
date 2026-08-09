export type IngestionJobResult = {
  jobId: string;
  dataSourceId: string;
  status: string;
  inserted: number;
  updated: number;
  skipped: number;
};

export type RunDueResult = {
  jobs: IngestionJobResult[];
  count: number;
};

export function runIngestionJob(
  prisma: unknown,
  options: {
    jobId: string;
    triggeredBy?: string;
    now?: Date;
    fetchImpl?: unknown;
    maxBytes?: number;
    timeoutMs?: number;
  },
): Promise<{ status: string; inserted: number; updated: number; skipped: number; reason?: string; runId?: string }>;

export function normalizeDate(value: unknown): Date | null;
export function normalizeNumber(value: unknown): number | null;
export function normalizeCoordinate(value: unknown, axis: "lng" | "lat"): number | null;
export function dedupeKey(input: Record<string, unknown>): string;
export function computeSchemaFingerprint(candidates: Array<Record<string, unknown>>): string;
export function parseCsv(text: string): Record<string, string>[];
export function parseJmaAtomFeed(
  bodyText: string,
): Array<{ title: string; id: string; url: string | null; updated: string | null; summary: string | null }>;
export function parsePayload(
  bodyText: string,
  contentType: string | null,
  source: { name: string; category: string; providerName?: string | null; dataFormat?: string | null },
): Array<Record<string, unknown>>;

export function runDueIngestionJobs(
  prisma: unknown,
  options: { maxJobs?: number; now?: Date; triggeredBy?: string; fetchImpl?: unknown },
): Promise<RunDueResult>;

export function stopIngestionRun(
  prisma: unknown,
  options: { runId: string; note?: string },
): Promise<{ status: string; changed: boolean }>;
