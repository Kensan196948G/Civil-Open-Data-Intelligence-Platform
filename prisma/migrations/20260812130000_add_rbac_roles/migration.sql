-- RBAC: roles / role_assignments (docs/design/rbac-design.md, Phase 1)

CREATE TABLE "roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userEmail" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "grantedBy" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- 有効な割当（revokedAt IS NULL）を一意化する部分インデックス。
-- revokedAt を含む複合一意では NULL が重複を防がないため（SQLite/PostgreSQL共通）。
CREATE UNIQUE INDEX "role_assignments_active_unique" ON "role_assignments"("userEmail", "roleId", "scope") WHERE "revokedAt" IS NULL;
CREATE INDEX "role_assignments_userEmail_revokedAt_idx" ON "role_assignments"("userEmail", "revokedAt");
CREATE INDEX "role_assignments_roleId_idx" ON "role_assignments"("roleId");
