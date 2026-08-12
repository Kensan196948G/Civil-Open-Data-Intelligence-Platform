-- RBAC: roles / role_assignments (docs/design/rbac-design.md, Phase 1)

CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

CREATE TABLE "role_assignments" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "grantedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "role_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "role_assignments_userEmail_roleId_scope_revokedAt_key" ON "role_assignments"("userEmail", "roleId", "scope", "revokedAt");
CREATE INDEX "role_assignments_userEmail_revokedAt_idx" ON "role_assignments"("userEmail", "revokedAt");
CREATE INDEX "role_assignments_roleId_idx" ON "role_assignments"("roleId");
