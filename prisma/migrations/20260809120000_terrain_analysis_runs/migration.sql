-- Terrain analysis case save (統合: Civil-Terrain-Slope-Risk-Viewer analysis_runs)

CREATE TABLE "terrain_analysis_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "tab" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "terrain_analysis_runs_lat_lon_idx" ON "terrain_analysis_runs"("lat", "lon");
CREATE INDEX "terrain_analysis_runs_createdAt_idx" ON "terrain_analysis_runs"("createdAt");
