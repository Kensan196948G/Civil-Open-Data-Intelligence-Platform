-- Construction sites, weather/marine observations, thresholds, decisions
-- (統合: wmcdss Weather-Marine Construction DSS)

CREATE TABLE "construction_sites" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "jmaStationId" TEXT,
    "waveGridLat" DOUBLE PRECISION,
    "waveGridLon" DOUBLE PRECISION,
    "address" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "construction_sites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "construction_sites_code_key" ON "construction_sites"("code");
CREATE INDEX "construction_sites_kind_idx" ON "construction_sites"("kind");

CREATE TABLE "weather_thresholds" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "workType" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "severity" TEXT NOT NULL,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "weather_thresholds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weather_thresholds_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "weather_thresholds_workType_metric_idx" ON "weather_thresholds"("workType", "metric");

CREATE TABLE "weather_observations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "temperatureC" DOUBLE PRECISION,
    "humidityPct" DOUBLE PRECISION,
    "pressureHpa" DOUBLE PRECISION,
    "precipMm" DOUBLE PRECISION,
    "windSpeedMs" DOUBLE PRECISION,
    "windGustMs" DOUBLE PRECISION,
    "windDirDeg" DOUBLE PRECISION,
    "sunshineH" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'jma',
    CONSTRAINT "weather_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weather_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "weather_observations_siteId_observedAt_dataVersion_key" ON "weather_observations"("siteId", "observedAt", "dataVersion");
CREATE INDEX "weather_observations_siteId_observedAt_idx" ON "weather_observations"("siteId", "observedAt");

CREATE TABLE "marine_observations" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "sigWaveHM" DOUBLE PRECISION,
    "wavePeriodS" DOUBLE PRECISION,
    "waveDirDeg" DOUBLE PRECISION,
    "tideLevelM" DOUBLE PRECISION,
    "currentSpeedMs" DOUBLE PRECISION,
    "currentDirDeg" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'jma_wave',
    CONSTRAINT "marine_observations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marine_observations_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "marine_observations_siteId_observedAt_dataVersion_key" ON "marine_observations"("siteId", "observedAt", "dataVersion");
CREATE INDEX "marine_observations_siteId_observedAt_idx" ON "marine_observations"("siteId", "observedAt");

CREATE TABLE "decision_records" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "targetWindowStart" TIMESTAMP(3) NOT NULL,
    "targetWindowEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "thresholdsSnapshot" JSONB NOT NULL,
    "generatedBy" TEXT NOT NULL DEFAULT 'system',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "decision_records_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "decision_records_siteId_generatedAt_idx" ON "decision_records"("siteId", "generatedAt");
