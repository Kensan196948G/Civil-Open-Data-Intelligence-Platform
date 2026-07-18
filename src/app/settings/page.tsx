import { prisma } from "@/lib/db";
import { FETCH_TIMEOUT_MS, MAX_REDIRECTS, PREVIEW_MAX_BYTES, STALE_CHECK_DAYS } from "@/lib/constants";
import { AdminTokenPanel } from "@/components/AdminTokenPanel";
import { ApiKeyPanel } from "@/components/ApiKeyPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "設定",
};

// デザイン正本 (settings view: 3812-3945 行) の選択肢リストと同一
const OPERATION_SETTINGS = [
  { id: "setting-timeout", label: "⏱ タイムアウト", value: FETCH_TIMEOUT_MS / 1000, unit: "秒", options: [10, 30, 60, 120] },
  { id: "setting-redirect", label: "🔁 リダイレクト上限", value: MAX_REDIRECTS, unit: "回", options: [0, 1, 3, 5] },
  { id: "setting-preview", label: "📦 プレビュー保存上限", value: PREVIEW_MAX_BYTES / 1024, unit: "KB", options: [1, 4, 8, 16] },
  { id: "setting-stale", label: "⚠️ 要確認となる未確認期間", value: STALE_CHECK_DAYS, unit: "日", options: [30, 60, 90, 180] },
];

export default async function SettingsPage() {
  const apiKeySources = await prisma.dataSource.findMany({
    where: { requiresApiKey: true },
    select: { id: true, name: true, apiKeyEnvName: true },
    orderBy: { name: "asc" },
  });
  const apiKeyOptions = apiKeySources.map((s) => ({
    id: s.id,
    label: `${s.name}(${s.apiKeyEnvName || "ENV未設定"})`,
  }));

  return (
    <div className="flex max-w-[640px] flex-col gap-[14px]">
      <h1 className="m-0 text-[1.4rem] font-semibold">⚙️ 設定</h1>

      <div className="dc-card px-[18px] py-[17px]">
        <h2 className="mb-2.5 mt-0 text-sm font-semibold text-[var(--ink)]">🔧 接続確認の動作設定</h2>
        <div className="flex flex-col gap-[11px]">
          {OPERATION_SETTINGS.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <label htmlFor={s.id} className="text-[13px] text-[var(--ink-2)]">
                {s.label}
              </label>
              {/* 値はサーバー側定数 (src/lib/constants) 由来のため画面からは変更不可。
                  デザイン正本のセレクト表現を維持しつつ disabled で明示する */}
              <select
                id={s.id}
                className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-[7px] text-[13px] text-[var(--ink)] outline-none disabled:cursor-not-allowed"
                defaultValue={s.value}
                disabled
              >
                {s.options.map((o) => (
                  <option key={o} value={o}>
                    {o} {s.unit}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <p className="mb-0 mt-3 text-[11.5px] text-[var(--muted)]">
          ※ これらの値はサーバー側の定数で管理されています。変更はデプロイ設定 (
          <code>src/lib/constants.ts</code>) で行います。
        </p>
      </div>

      <ApiKeyPanel sources={apiKeyOptions} />

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
