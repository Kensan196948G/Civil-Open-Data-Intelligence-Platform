-- AlterTable
ALTER TABLE "providers" ADD COLUMN "ingestionRateLimitMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ingestion_runs" ADD COLUMN "schemaFingerprint" TEXT;
ALTER TABLE "ingestion_runs" ADD COLUMN "schemaChanged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ingestion_runs" ADD COLUMN "deadLetterReason" TEXT;
