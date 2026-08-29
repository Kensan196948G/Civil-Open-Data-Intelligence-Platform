import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from ".prisma/client-postgresql";

/**
 * 監査ロールバックの実DB統合テスト（Issue #140）。
 *
 * 単位テスト（tests/unit/audit-transaction-routes.test.ts）は prisma をモックし、
 * 実トランザクションの commit/rollback を再現しない。本テストは使い捨ての
 * PostgreSQL（CI postgresql-compat ジョブの service container）で実測する。
 *
 * 実行条件: RUN_DB_INTEGRATION=1 かつ DATABASE_URL が実PostgreSQLを指すこと。
 * 未指定時は skip（通常の vitest 実行＝verify ジョブを汚染しない）。
 * 本番 DB には決して接続しない（CI の使い捨てコンテナのみを対象とする）。
 */

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";

// 実行時に一意なマーカーを付与し、既存データや並行実行と衝突しないようにする。
const marker = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// テスト終了後に作成レコードを掃除するためのID保持
const created = { dataSourceId: "" as string | null, fetchLogId: "" as string | null };

const prisma = runIntegration ? new PrismaClient() : null;

describe.skipIf(!runIntegration)("監査トランザクションの実DB統合テスト (#140)", () => {
  afterAll(async () => {
    if (!prisma) return;
    try {
      if (created.fetchLogId) {
        await prisma.fetchLog.deleteMany({ where: { id: created.fetchLogId } });
      }
      if (created.dataSourceId) {
        await prisma.dataSource.deleteMany({ where: { id: created.dataSourceId } });
      }
      await prisma.auditLog.deleteMany({
        where: { detail: { contains: marker } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("監査INSERT失敗時は業務書き込み（fetch_log / data_sources）が永続化されない", async () => {
    if (!prisma) return;
    const before = await prisma.$transaction([
      prisma.fetchLog.count(),
      prisma.dataSource.count(),
    ]);

    const provider = await prisma.provider.findFirst();
    if (!provider) throw new Error("test requires at least one provider row (run after seed)");
    // 監査INSERTを実DBレベルで失敗させるための「既存監査行」（主キー重複 violation）。
    // seed は audit_logs を作らないため、テスト内で1件用意する。
    const seedAudit = await prisma.auditLog.create({
      data: {
        actor: "システム",
        action: "テスト準備",
        target: `監査rollback失敗系-${marker}`,
        level: "info",
        detail: marker,
      },
    });
    const existingAuditId = seedAudit.id;

    let rollbackError: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        const source = await tx.dataSource.create({
          data: {
            name: `監査rollback失敗系-${marker}`,
            officialUrl: `https://example.invalid/${marker}/failure`,
            providerId: provider.id,
            category: "other",
            dataFormat: "JSON",
            accessType: "api",
          },
        });
        created.dataSourceId = source.id;
        await tx.fetchLog.create({
          data: {
            dataSourceId: source.id,
            executionType: "check",
            requestUrl: `https://example.invalid/${marker}/failure`,
            method: "GET",
            success: true,
          },
        });
        // 監査INSERTの失敗を再現: 既存 id を明示して主キー重複を起こす。
        // Prisma の $transaction は例外で全体を rollback するはず。
        await tx.auditLog.create({
          data: {
            id: existingAuditId,
            actor: "システム",
            action: "接続確認実行",
            target: `監査rollback失敗系-${marker}`,
            level: "info",
            detail: marker,
          },
        });
      });
    } catch (error) {
      rollbackError = error;
    }

    expect(rollbackError).not.toBeNull();
    expect(String(rollbackError)).toMatch(/Unique|unique|P2002/i);

    // 業務書き込みが永続化されていないこと（件数が増えていないこと）
    const after = await prisma.$transaction([
      prisma.fetchLog.count(),
      prisma.dataSource.count(),
    ]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);

    // 明示的に存在しないことも確認
    const orphanSource = await prisma.dataSource.findFirst({
      where: { name: `監査rollback失敗系-${marker}` },
    });
    expect(orphanSource).toBeNull();
    created.dataSourceId = null; // rollback 済みのため掃除不要
  });

  it("監査INSERT成功時は業務書き込みと監査ログの両方が永続化される", async () => {
    if (!prisma) return;
    const provider = await prisma.provider.findFirst();
    if (!provider) throw new Error("test requires at least one provider row (run after seed)");

    const source = await prisma.$transaction(async (tx) => {
      const createdSource = await tx.dataSource.create({
        data: {
          name: `監査rollback成功系-${marker}`,
          officialUrl: `https://example.invalid/${marker}/success`,
          providerId: provider.id,
          category: "other",
          dataFormat: "JSON",
          accessType: "api",
        },
      });
      created.dataSourceId = createdSource.id;
      const log = await tx.fetchLog.create({
        data: {
          dataSourceId: createdSource.id,
          executionType: "check",
          requestUrl: `https://example.invalid/${marker}/success`,
          method: "GET",
          success: true,
        },
      });
      created.fetchLogId = log.id;
      await tx.auditLog.create({
        data: {
          actor: "システム",
          action: "接続確認実行",
          target: `監査rollback成功系-${marker}`,
          level: "success",
          detail: marker,
        },
      });
      return createdSource;
    });

    const persisted = await prisma.dataSource.findUnique({
      where: { id: source.id },
      include: { fetchLogs: true },
    });
    expect(persisted).not.toBeNull();
    expect(persisted?.fetchLogs.length).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { target: `監査rollback成功系-${marker}` },
    });
    expect(audit).not.toBeNull();
    expect(audit?.level).toBe("success");
  });
});
