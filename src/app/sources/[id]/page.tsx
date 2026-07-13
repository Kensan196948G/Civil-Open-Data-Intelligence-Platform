import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { categoryLabel } from "@/lib/constants";
import { safeFetchLogDto, safeSampleResponseDto } from "@/lib/operational-dto";
import { StatusBadge } from "@/components/StatusBadge";
import { QualityScoreBadge, TrustLevelBadge } from "@/components/QualityScoreBadge";
import { FetchLogTable } from "@/components/FetchLogTable";
import { CheckPanel } from "@/components/CheckPanel";
import { DeleteSourceButton } from "@/components/DeleteSourceButton";
import { sanitizeUrl } from "@/lib/url-safety";

export const dynamic = "force-dynamic";

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canManage = isAdminHeaders(await headers());
  const source = await prisma.dataSource.findUnique({
    where: { id },
    include: {
      provider: true,
      tags: { include: { tag: true } },
      qualityChecks: { orderBy: { checkedAt: "desc" }, take: 3 },
      relatedUseCases: true,
      ...(canManage
        ? {
            fetchLogs: { orderBy: { executedAt: "desc" }, take: 20 },
            sampleResponses: { orderBy: { createdAt: "desc" }, take: 3 },
          }
        : {}),
    },
  });
  if (!source) notFound();

  const dtCls = "text-xs text-slate-500";
  const ddCls = "text-sm text-slate-800 break-all";
  const fetchLogs = canManage && "fetchLogs" in source ? source.fetchLogs.map((log) => safeFetchLogDto(log)) : [];
  const sampleResponses =
    canManage && "sampleResponses" in source
      ? source.sampleResponses.map((sample) => safeSampleResponseDto(sample))
      : [];
  const officialUrl = sanitizeUrl(source.officialUrl);
  const endpointUrl = source.endpointUrl ? sanitizeUrl(source.endpointUrl) : null;
  const documentationUrl = source.documentationUrl ? sanitizeUrl(source.documentationUrl) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">📄 {source.name}</h1>
          <p className="text-sm text-slate-500">
            {source.provider.name} / {categoryLabel(source.category)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={source.status} />
          <QualityScoreBadge score={source.qualityScore} />
          <TrustLevelBadge level={source.trustLevel} />
          {canManage && (
            <>
              <Link
                href={`/sources/${source.id}/edit`}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                ✏️ 編集
              </Link>
              <DeleteSourceButton sourceId={source.id} name={source.name} />
            </>
          )}
        </div>
      </div>

      {canManage ? (
        <CheckPanel sourceId={source.id} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          接続確認、サンプル取得、品質再計算、編集、削除には管理セッションが必要です。
          <Link href="/settings" className="ml-1 font-medium underline">
            設定画面
          </Link>
          で管理操作トークンを確認してください。
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">📌 基本情報</h2>
          <dl className="grid grid-cols-1 gap-3">
            {source.description && (
              <div>
                <dt className={dtCls}>概要</dt>
                <dd className={ddCls}>{source.description}</dd>
              </div>
            )}
            <div>
              <dt className={dtCls}>🔗 公式URL</dt>
              <dd className={ddCls}>
                <a href={officialUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {officialUrl}
                </a>
              </dd>
            </div>
            {endpointUrl && (
              <div>
                <dt className={dtCls}>🔌 APIエンドポイント</dt>
                <dd className={ddCls}>{endpointUrl}</dd>
              </div>
            )}
            {documentationUrl && (
              <div>
                <dt className={dtCls}>📄 API仕様書</dt>
                <dd className={ddCls}>
                  <a href={documentationUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {documentationUrl}
                  </a>
                </dd>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className={dtCls}>データ形式</dt>
                <dd className={ddCls}>{source.dataFormat}</dd>
              </div>
              <div>
                <dt className={dtCls}>アクセス方式</dt>
                <dd className={ddCls}>{source.accessType}</dd>
              </div>
              <div>
                <dt className={dtCls}>更新頻度</dt>
                <dd className={ddCls}>{source.updateFrequency ?? "不明"}</dd>
              </div>
              <div>
                <dt className={dtCls}>最終確認日</dt>
                <dd className={ddCls}>
                  {source.lastCheckedAt
                    ? new Date(source.lastCheckedAt).toLocaleString("ja-JP")
                    : "未確認"}
                </dd>
              </div>
            </div>
            <div>
              <dt className={dtCls}>🏷️ タグ</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {source.tags.length > 0
                  ? source.tags.map(({ tag }) => (
                      <span key={tag.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {tag.name}
                      </span>
                    ))
                  : "-"}
              </dd>
            </div>
            {canManage && source.note && (
              <div>
                <dt className={dtCls}>備考</dt>
                <dd className={ddCls}>{source.note}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">📜 利用条件</h2>
          <dl className="space-y-3">
            <div>
              <dt className={dtCls}>ライセンス</dt>
              <dd className={ddCls}>{source.licenseName ?? "要確認"}</dd>
            </div>
            <div>
              <dt className={dtCls}>商用利用</dt>
              <dd className={ddCls}>
                {source.commercialUse === "allowed"
                  ? "✅ 可"
                  : source.commercialUse === "restricted"
                    ? "⚠️ 制限あり"
                    : "❓ 要確認"}
              </dd>
            </div>
            <div>
              <dt className={dtCls}>出典表記</dt>
              <dd className={ddCls}>{source.attributionRequired ? "必要" : "不要"}</dd>
            </div>
            <div>
              <dt className={dtCls}>🔑 APIキー</dt>
              <dd className={ddCls}>
                {source.requiresApiKey
                  ? canManage
                    ? `必要（環境変数: ${source.apiKeyEnvName ?? "未設定"}）`
                    : "必要（環境変数名は管理者のみ表示）"
                  : "不要"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ⚠️ 商用利用可否・再配布可否の最終判断は、必ず公式の利用規約を確認して人間が行ってください。
          </p>

          {source.relatedUseCases.length > 0 && (
            <>
              <h2 className="mt-5 mb-2 text-sm font-semibold text-slate-700">💡 関連ユースケース</h2>
              <ul className="space-y-1 text-sm">
                {source.relatedUseCases.map((uc) => (
                  <li key={uc.id} className="rounded bg-slate-50 px-2 py-1">
                    <span className="font-medium">{uc.useCaseName}</span>
                    {uc.targetSystem && <span className="ml-2 text-xs text-slate-500">→ {uc.targetSystem}</span>}
                    {uc.description && <p className="text-xs text-slate-500">{uc.description}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {source.qualityChecks.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">⭐ 品質評価履歴</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="sr-only">品質評価履歴</caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th scope="col" className="px-2 py-2">評価日時</th>
                  <th scope="col" className="px-2 py-2">公式性</th>
                  <th scope="col" className="px-2 py-2">鮮度</th>
                  <th scope="col" className="px-2 py-2">接続安定性</th>
                  <th scope="col" className="px-2 py-2">利用条件</th>
                  <th scope="col" className="px-2 py-2">形式</th>
                  <th scope="col" className="px-2 py-2">関連度</th>
                  <th scope="col" className="px-2 py-2">合計</th>
                </tr>
              </thead>
              <tbody>
                {source.qualityChecks.map((qc) => (
                  <tr key={qc.id} className="border-b border-slate-100">
                    <th scope="row" className="px-2 py-2 text-left">{new Date(qc.checkedAt).toLocaleString("ja-JP")}</th>
                    <td className="px-2 py-2">{qc.officialSourceScore}/20</td>
                    <td className="px-2 py-2">{qc.freshnessScore}/15</td>
                    <td className="px-2 py-2">{qc.accessibilityScore}/15</td>
                    <td className="px-2 py-2">{qc.licenseClarityScore}/15</td>
                    <td className="px-2 py-2">{qc.formatUsabilityScore}/15</td>
                    <td className="px-2 py-2">{qc.constructionRelevanceScore}/20</td>
                    <td className="px-2 py-2 font-bold">{qc.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sampleResponses.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">📦 サンプルレスポンス</h2>
          {sampleResponses.map((sample) => (
            <div key={sample.id} className="mb-3">
              <p className="mb-1 text-xs text-slate-500">
                {new Date(sample.createdAt).toLocaleString("ja-JP")}
                {sample.detectedFormat && ` / 判定形式: ${sample.detectedFormat}`}
              </p>
              <pre className="max-h-48 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                {sample.previewText || "(プレビューなし)"}
              </pre>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">🧾 取得ログ（直近20件）</h2>
        {canManage && "fetchLogs" in source ? (
          <FetchLogTable logs={fetchLogs} showSource={false} />
        ) : (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
            取得ログとサンプルレスポンスは運用情報を含むため、管理者確認時のみ表示します。
          </p>
        )}
      </section>
    </div>
  );
}
