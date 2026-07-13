CREATE INDEX "fetch_logs_dataSourceId_executedAt_idx" ON "fetch_logs"("dataSourceId", "executedAt");
CREATE INDEX "fetch_logs_executedAt_idx" ON "fetch_logs"("executedAt");
CREATE INDEX "sample_responses_dataSourceId_createdAt_idx" ON "sample_responses"("dataSourceId", "createdAt");
CREATE INDEX "sample_responses_createdAt_idx" ON "sample_responses"("createdAt");
