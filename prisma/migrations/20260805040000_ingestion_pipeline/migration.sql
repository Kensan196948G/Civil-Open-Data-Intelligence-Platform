-- CreateTable
CREATE TABLE "ingestion_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataSourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
    "maxRecords" INTEGER NOT NULL DEFAULT 500,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "lastStatus" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ingestion_jobs_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_jobs_dataSourceId_key" ON "ingestion_jobs"("dataSourceId");

-- CreateIndex
CREATE INDEX "ingestion_jobs_enabled_nextRunAt_idx" ON "ingestion_jobs"("enabled", "nextRunAt");

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "ingestion_runs_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "ingestion_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ingestion_runs_ingestionJobId_startedAt_idx" ON "ingestion_runs"("ingestionJobId", "startedAt");

-- CreateIndex
CREATE INDEX "ingestion_runs_status_startedAt_idx" ON "ingestion_runs"("status", "startedAt");
