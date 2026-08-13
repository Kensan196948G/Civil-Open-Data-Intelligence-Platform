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
import { WatchToggle } from "@/components/WatchToggle";
import { sanitizeUrl } from "@/lib/url-safety";

export const metadata = {
  title: "データソース詳細",
};

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

  // デザイン正本 (1365-2306 行): dt=muted 12px 600 / dd=ink 12.5px
  const dtCls = "text-xs font-semibold text-[var(--muted)]";
  const ddCls = "mt-0.5 text-[12.5px] text-[var(--ink)] break-all";
  const cardCls = "dc-card px-[18px] py-[17px]";
  const h2Cls = "mb-3 text-sm font-semibold text-[var(--ink)]";
  const fetchLogs = canManage && "fetchLogs" in source ? source.fetchLogs.map((log) => safeFetchLogDto(log)) : [];
  const sampleResponses =
    canManage && "sampleResponses" in source
      ? source.sampleResponses.map((sample) => safeSampleResponseDto(sample))
      : [];
  const officialUrl = sanitizeUrl(source.officialUrl);
  const endpointUrl = source.endpointUrl ? sanitizeUrl(source.endpointUrl) : null;
  const documentationUrl = source.documentationUrl ? sanitizeUrl(source.documentationUrl) : null;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sources" className="text-[12px] text-[var(--muted)] hover:underline">
        ← 一覧に戻る
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div>
          <h1 className="text-[1.3rem] font-semibold">📄 {source.name}</h1>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            {source.provider.name} / {categoryLabel(source.category)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <WatchToggle targetType="dataSource" targetId={source.id} />}
          <StatusBadge status={source.status} />
          <QualityScoreBadge score={source.qualityScore} />
          <TrustLevelBadge level={source.trustLevel} />
          {canManage && (
            <>
              <Link href={`/sources/${source.id}/edit`} className="dc-btn-ghost">
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
        <div className="dc-card px-[18px] py-[13px] text-[12.5px] text-[var(--amber)]">
          接続確認、サンプル取得、品質再計算、編集、削除には管理セッションが必要です。
          <Link href="/settings" className="ml-1 font-semibold underline">
            設定画面
          </Link>
          で管理操作トークンを確認してください。
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className={cardCls}>
          <h2 className={h2Cls}>📌 基本情報</h2>
          <dl className="flex flex-col gap-[11px]">
            {source.description && (
              <div>
                <dt className={dtCls}>概要</dt>
                <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.description}</dd>
              </div>
            )}
            <div>
              <dt className={dtCls}>🔗 公式URL</dt>
              <dd className={ddCls}>
                <a href={officialUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--blue)] hover:underline">
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
                  <a href={documentationUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--blue)] hover:underline">
                    {documentationUrl}
                  </a>
                </dd>
              </div>
            )}
            <div className="grid grid-cols-2 gap-[11px]">
              <div>
                <dt className={dtCls}>データ形式</dt>
                <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.dataFormat}</dd>
              </div>
              <div>
                <dt className={dtCls}>アクセス方式</dt>
                <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.accessType}</dd>
              </div>
              <div>
                <dt className={dtCls}>更新頻度</dt>
                <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.updateFrequency ?? "不明"}</dd>
              </div>
              <div>
                <dt className={dtCls}>最終確認日</dt>
                <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">
                  {source.lastCheckedAt
                    ? new Date(source.lastCheckedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
                    : "未確認"}
                </dd>
              </div>
            </div>
            <div>
              <dt className={dtCls}>🏷️ タグ</dt>
              <dd className="mt-[5px] flex flex-wrap gap-[5px]">
                {source.tags.length > 0
                  ? source.tags.map(({ tag }) => (
                      <span key={tag.id} className="rounded-[20px] bg-[var(--subtle)] px-[9px] py-0.5 text-[11.5px] text-[var(--ink-2)]">
                        {tag.name}
                      </span>
                    ))
                  : "-"}
              </dd>
            </div>
            {canManage && source.note && (
              <div>
                <dt className={dtCls}>備考</dt>
                <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.note}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className={cardCls}>
          <h2 className={h2Cls}>📜 利用条件</h2>
          <dl className="flex flex-col gap-[11px]">
            <div>
              <dt className={dtCls}>ライセンス</dt>
              <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.licenseName ?? "要確認"}</dd>
            </div>
            <div>
              <dt className={dtCls}>商用利用</dt>
              <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">
                {source.commercialUse === "allowed"
                  ? "✅ 可"
                  : source.commercialUse === "restricted"
                    ? "⚠️ 制限あり"
                    : "❓ 要確認"}
              </dd>
            </div>
            <div>
              <dt className={dtCls}>出典表記</dt>
              <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">{source.attributionRequired ? "必要" : "不要"}</dd>
            </div>
            <div>
              <dt className={dtCls}>🔑 APIキー</dt>
              <dd className="mt-0.5 text-[12.5px] text-[var(--ink)]">
                {source.requiresApiKey
                  ? canManage
                    ? `必要（環境変数: ${source.apiKeyEnvName ?? "未設定"}）`
                    : "必要（環境変数名は管理者のみ表示）"
                  : "不要"}
              </dd>
            </div>
          </dl>
          <p className="mt-[14px] rounded-lg bg-[var(--amber-bg)] px-3 py-[9px] text-[11.5px] text-[var(--amber)]">
            ⚠️ 商用利用可否・再配布可否の最終判断は、必ず公式の利用規約を確認して人間が行ってください。
          </p>

          {source.relatedUseCases.length > 0 && (
            <>
              <h2 className="mb-2 mt-4 text-sm font-semibold text-[var(--ink)]">💡 関連ユースケース</h2>
              <ul className="flex flex-col gap-[6px]">
                {source.relatedUseCases.map((uc) => (
                  <li key={uc.id} className="rounded-[7px] bg-[var(--subtle)] px-2.5 py-[7px]">
                    <div className="text-[12.5px] font-medium text-[var(--ink)]">
                      {uc.useCaseName}
                      {uc.targetSystem && <span className="ml-1.5 text-[11px] font-normal text-[var(--muted)]">→ {uc.targetSystem}</span>}
                    </div>
                    {uc.description && <p className="text-[11.5px] text-[var(--muted)]">{uc.description}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {source.qualityChecks.length > 0 && (
        <section className={`${cardCls} overflow-x-auto`}>
          <h2 className={h2Cls}>⭐ 品質評価履歴</h2>
          <table className="w-full border-collapse text-[12.5px]">
            <caption className="sr-only">品質評価履歴</caption>
            <thead>
              <tr>
                <th scope="col" className="dc-th">評価日時</th>
                <th scope="col" className="dc-th">公式性</th>
                <th scope="col" className="dc-th">鮮度</th>
                <th scope="col" className="dc-th">接続安定性</th>
                <th scope="col" className="dc-th">利用条件</th>
                <th scope="col" className="dc-th">形式</th>
                <th scope="col" className="dc-th">関連度</th>
                <th scope="col" className="dc-th">合計</th>
              </tr>
            </thead>
            <tbody>
              {source.qualityChecks.map((qc) => (
                <tr key={qc.id}>
                  <th scope="row" className="dc-td text-left">{new Date(qc.checkedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</th>
                  <td className="dc-td">{qc.officialSourceScore}/20</td>
                  <td className="dc-td">{qc.freshnessScore}/15</td>
                  <td className="dc-td">{qc.accessibilityScore}/15</td>
                  <td className="dc-td">{qc.licenseClarityScore}/15</td>
                  <td className="dc-td">{qc.formatUsabilityScore}/15</td>
                  <td className="dc-td">{qc.constructionRelevanceScore}/20</td>
                  <td className="dc-td font-bold">{qc.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sampleResponses.length > 0 && (
        <section className={cardCls}>
          <h2 className={h2Cls}>📦 サンプルレスポンス</h2>
          {sampleResponses.map((sample) => (
            <div key={sample.id} className="mb-3">
              <p className="mb-1 text-[11.5px] text-[var(--muted)]">
                {new Date(sample.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                {sample.detectedFormat && ` / 判定形式: ${sample.detectedFormat}`}
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-[var(--ink)] p-3 text-xs text-white">
                {sample.previewText || "(プレビューなし)"}
              </pre>
            </div>
          ))}
        </section>
      )}

      <section className={`${cardCls} overflow-x-auto`}>
        <h2 className={h2Cls}>🧾 取得ログ（直近20件）</h2>
        {canManage && "fetchLogs" in source ? (
          <FetchLogTable logs={fetchLogs} showSource={false} />
        ) : (
          <p className="rounded-lg bg-[var(--amber-bg)] px-3 py-[9px] text-[11.5px] text-[var(--amber)]">
            取得ログとサンプルレスポンスは運用情報を含むため、管理者確認時のみ表示します。
          </p>
        )}
      </section>
    </div>
  );
}
