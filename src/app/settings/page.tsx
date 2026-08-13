import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { OPERATION_SETTING_DEFS, getOperationSettings } from "@/lib/settings";
import { AdminTokenPanel } from "@/components/AdminTokenPanel";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";
import { OperationSettingsPanel } from "@/components/OperationSettingsPanel";
import { RoleManagementPanel } from "@/components/RoleManagementPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "設定",
};

// デザイン正本 (settings view) と同じアイコン付き表示ラベル
const SETTING_ICONS: Record<string, string> = {
  timeoutSec: "⏱",
  redirectLimit: "🔁",
  previewKb: "📦",
  staleDays: "⚠️",
};

export default async function SettingsPage() {
  const canEdit = isAdminHeaders(await headers());

  if (!canEdit) {
    return (
      <div className="flex max-w-[640px] flex-col gap-[14px]">
        <h1 className="m-0 text-[1.4rem] font-semibold">⚙️ 設定</h1>
        <div className="dc-card px-[18px] py-[17px]">
          <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">🔒 管理者専用</h2>
          <p className="mb-0 text-[13px] text-[var(--ink-2)]">
            設定の表示・変更には管理セッションが必要です。ページ下部の「🛡️ 管理操作トークン」からセッションを開始してください。
          </p>
        </div>
        <AdminTokenPanel />
      </div>
    );
  }

  const settings = await getOperationSettings();
  const settingRows = (
    Object.entries(OPERATION_SETTING_DEFS) as [
      keyof typeof OPERATION_SETTING_DEFS,
      (typeof OPERATION_SETTING_DEFS)[keyof typeof OPERATION_SETTING_DEFS],
    ][]
  ).map(([key, def]) => ({
    key,
    label: `${SETTING_ICONS[key] ?? ""} ${def.label}`.trim(),
    unit: def.unit,
    options: [...def.options],
    value: settings[key],
  }));

  const apiKeySources = await prisma.dataSource.findMany({
    where: { requiresApiKey: true },
    select: { id: true, name: true, apiKeyEnvName: true },
    orderBy: { name: "asc" },
  });
  const apiKeyOptions = apiKeySources.map((s) => ({
    id: s.id,
    label: `${s.name}(${s.apiKeyEnvName || "ENV未設定"})`,
  }));

  const roleAssignments = await prisma.roleAssignment.findMany({
    where: {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { role: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const roleOptions = (await prisma.role.findMany({ orderBy: { priority: "asc" } })).map(
    (r) => r.name,
  );

  return (
    <div className="flex max-w-[640px] flex-col gap-[14px]">
      <h1 className="m-0 text-[1.4rem] font-semibold">⚙️ 設定</h1>

      <OperationSettingsPanel rows={settingRows} canEdit={canEdit} />

      <ApiKeyPanel sources={apiKeyOptions} />

      <RoleManagementPanel
        roles={roleOptions.length > 0 ? roleOptions : ["viewer", "engineer", "data-steward", "admin", "auditor", "api-consumer"]}
        initialAssignments={roleAssignments.map((a) => ({
          id: a.id,
          userEmail: a.userEmail,
          role: a.role.name,
          scope: a.scope,
          expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
          createdAt: a.createdAt.toISOString(),
        }))}
      />

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">🛡️ セキュリティ制約</h2>
        <ul className="m-0 flex list-disc flex-col gap-[5px] pl-5 text-[13px] text-[var(--ink-2)]">
          <li>取得対象は登録済みデータソースのURLのみ（任意URL取得は不可）</li>
          <li>localhost・private IP・内部ドメインへのアクセスは拒否</li>
          <li>http / https 以外のスキームは拒否</li>
          <li>リダイレクト先も同じ検証を通過したもののみ追従</li>
        </ul>
      </div>

      {/* アプリ固有: 管理セッション開始 (デザイン正本には存在しないが管理機能に必須) */}
      <AdminTokenPanel />
    </div>
  );
}
