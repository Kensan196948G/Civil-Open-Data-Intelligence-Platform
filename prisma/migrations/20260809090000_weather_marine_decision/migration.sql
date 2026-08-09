-- Construction sites, weather/marine observations, thresholds, decisions
-- (統合: wmcdss Weather-Marine Construction DSS)

CREATE TABLE "construction_sites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "jmaStationId" TEXT,
    "waveGridLat" REAL,
    "waveGridLon" REAL,
    "address" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "construction_sites_code_key" ON "construction_sites"("code");
CREATE INDEX "construction_sites_kind_idx" ON "construction_sites"("kind");

CREATE TABLE "weather_thresholds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT,
    "workType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "severity" TEXT NOT NULL,
    "activeFrom" DATETIME,
    "activeTo" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "weather_thresholds_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "weather_thresholds_workType_metric_idx" ON "weather_thresholds"("workType", "metric");

CREATE TABLE "weather_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "temperatureC" REAL,
    "humidityPct" REAL,
    "pressureHpa" REAL,
    "precipMm" REAL,
    "windSpeedMs" REAL,
    "windGustMs" REAL,
    "windDirDeg" REAL,
    "sunshineH" REAL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'jma',
    CONSTRAINT "weather_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "weather_observations_siteId_observedAt_dataVersion_key" ON "weather_observations"("siteId", "observedAt", "dataVersion");
CREATE INDEX "weather_observations_siteId_observedAt_idx" ON "weather_observations"("siteId", "observedAt");

CREATE TABLE "marine_observations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "sigWaveHM" REAL,
    "wavePeriodS" REAL,
    "waveDirDeg" REAL,
    "tideLevelM" REAL,
    "currentSpeedMs" REAL,
    "currentDirDeg" REAL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'jma_wave',
    CONSTRAINT "marine_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marine_observations_siteId_observedAt_dataVersion_key" ON "marine_observations"("siteId", "observedAt", "dataVersion");
CREATE INDEX "marine_observations_siteId_observedAt_idx" ON "marine_observations"("siteId", "observedAt");

CREATE TABLE "decision_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "targetWindowStart" DATETIME NOT NULL,
    "targetWindowEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "inputs" TEXT NOT NULL,
    "thresholdsSnapshot" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'system',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_records_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "decision_records_siteId_generatedAt_idx" ON "decision_records"("siteId", "generatedAt");
