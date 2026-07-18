-- Prevent race-condition duplicates for the same official source URL.
CREATE UNIQUE INDEX "data_sources_officialUrl_key" ON "data_sources"("officialUrl");
