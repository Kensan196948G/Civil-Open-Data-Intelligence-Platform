-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "organizationType" TEXT NOT NULL,
    "officialUrl" TEXT,
    "country" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "officialUrl" TEXT NOT NULL,
    "endpointUrl" TEXT,
    "documentationUrl" TEXT,
    "category" TEXT NOT NULL,
    "dataFormat" TEXT NOT NULL,
    "accessType" TEXT NOT NULL,
    "requiresApiKey" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyEnvName" TEXT,
    "licenseName" TEXT,
    "commercialUse" TEXT NOT NULL DEFAULT 'unknown',
    "attributionRequired" BOOLEAN NOT NULL DEFAULT true,
    "updateFrequency" TEXT,
    "lastCheckedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "trustLevel" INTEGER NOT NULL DEFAULT 3,
    "qualityScore" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "data_sources_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "data_source_tags" (
    "dataSourceId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("dataSourceId", "tagId"),
    CONSTRAINT "data_source_tags_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "data_source_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fetch_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataSourceId" TEXT NOT NULL,
    "executionType" TEXT NOT NULL DEFAULT 'check',
    "requestUrl" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "responseTimeMs" INTEGER,
    "responseSizeBytes" INTEGER,
    "contentType" TEXT,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "note" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fetch_logs_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sample_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataSourceId" TEXT NOT NULL,
    "fetchLogId" TEXT,
    "previewText" TEXT,
    "filePath" TEXT,
    "detectedFormat" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sample_responses_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sample_responses_fetchLogId_fkey" FOREIGN KEY ("fetchLogId") REFERENCES "fetch_logs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataSourceId" TEXT NOT NULL,
    "officialSourceScore" INTEGER NOT NULL,
    "freshnessScore" INTEGER NOT NULL,
    "accessibilityScore" INTEGER NOT NULL,
    "licenseClarityScore" INTEGER NOT NULL,
    "formatUsabilityScore" INTEGER NOT NULL,
    "constructionRelevanceScore" INTEGER NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "checkNote" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quality_checks_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "related_use_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataSourceId" TEXT NOT NULL,
    "useCaseName" TEXT NOT NULL,
    "targetSystem" TEXT,
    "description" TEXT,
    CONSTRAINT "related_use_cases_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "providers_name_key" ON "providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");
