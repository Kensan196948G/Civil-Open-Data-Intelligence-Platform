-- Watchlist entries (notification base, docs/design/rbac-design.md Phase 1)

CREATE TABLE "watchlist_entries" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "watchlist_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "watchlist_entries_userEmail_targetType_targetId_key" ON "watchlist_entries"("userEmail", "targetType", "targetId");
CREATE INDEX "watchlist_entries_userEmail_enabled_idx" ON "watchlist_entries"("userEmail", "enabled");
