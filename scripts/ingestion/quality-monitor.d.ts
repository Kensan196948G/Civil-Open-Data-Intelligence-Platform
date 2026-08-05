export type QualityMonitoringSummary = {
  checkedAt: string;
  windowHours: number;
  statusCounts: Record<string, number>;
  deadLetters: Array<Record<string, unknown>>;
  schemaChanges: Array<Record<string, unknown>>;
  staleJobs: Array<Record<string, unknown>>;
  anomalies: Array<Record<string, unknown>>;
};

export function getQualityMonitoringSummary(
  prisma: unknown,
  options?: { hours?: number; now?: Date },
): Promise<QualityMonitoringSummary>;

export function hasAnomalies(summary: QualityMonitoringSummary): boolean;
