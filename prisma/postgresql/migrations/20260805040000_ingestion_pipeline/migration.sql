-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "maxRecords" INTEGER NOT NULL DEFAULT 500,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_jobs_dataSourceId_key" ON "ingestion_jobs"("dataSourceId");

-- CreateIndex
CREATE INDEX "ingestion_jobs_enabled_nextRunAt_idx" ON "ingestion_jobs"("enabled", "nextRunAt");

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" TEXT NOT NULL,
    "ingestionJobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triggeredBy" TEXT NOT NULL DEFAULT 'manual',
    "requestUrl" TEXT,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "statusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "bytesReceived" INTEGER,
    "recordsInserted" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingestion_runs_ingestionJobId_startedAt_idx" ON "ingestion_runs"("ingestionJobId", "startedAt");

-- CreateIndex
CREATE INDEX "ingestion_runs_status_startedAt_idx" ON "ingestion_runs"("status", "startedAt");

-- AlterTable
ALTER TABLE "standard_records" ADD COLUMN "ingestionRunId" TEXT;

-- CreateIndex
CREATE INDEX "standard_records_ingestionRunId_idx" ON "standard_records"("ingestionRunId");

-- AddForeignKey
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "ingestion_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standard_records" ADD CONSTRAINT "standard_records_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
