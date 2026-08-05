// TypeScript wrapper around the shared CommonJS ingestion engine.
// The engine lives in scripts/ so the GitHub Actions runner can require it
// without a transpiler; this wrapper lets Next.js routes and Vitest use the
// same implementation with type declarations.
import * as engine from "../../../scripts/ingestion/ingestion-engine";

export const runIngestionJob = engine.runIngestionJob;
export const runDueIngestionJobs = engine.runDueIngestionJobs;
export const stopIngestionRun = engine.stopIngestionRun;
export const normalizeDate = engine.normalizeDate;
export const normalizeNumber = engine.normalizeNumber;
export const normalizeCoordinate = engine.normalizeCoordinate;
export const dedupeKey = engine.dedupeKey;
export const parseCsv = engine.parseCsv;
export const parsePayload = engine.parsePayload;
