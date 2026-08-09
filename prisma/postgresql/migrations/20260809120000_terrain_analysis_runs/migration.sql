-- Terrain analysis case save (統合: Civil-Terrain-Slope-Risk-Viewer analysis_runs)

CREATE TABLE "terrain_analysis_runs" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "tab" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "terrain_analysis_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "terrain_analysis_runs_lat_lon_idx" ON "terrain_analysis_runs"("lat", "lon");
CREATE INDEX "terrain_analysis_runs_createdAt_idx" ON "terrain_analysis_runs"("createdAt");
