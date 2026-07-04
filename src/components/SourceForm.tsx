"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCESS_TYPES,
  CATEGORIES,
  COMMERCIAL_USE_OPTIONS,
  DATA_FORMATS,
  SOURCE_STATUSES,
} from "@/lib/constants";

export type ProviderOption = { id: string; name: string };
export type TagOption = { id: string; name: string };

export type SourceFormValues = {
  name: string;
  nameEn: string;
  providerId: string;
  providerName: string;
  description: string;
  officialUrl: string;
  endpointUrl: string;
  documentationUrl: string;
  category: string;
  dataFormat: string;
  accessType: string;
  requiresApiKey: boolean;
  apiKeyEnvName: string;
  licenseName: string;
  commercialUse: string;
  attributionRequired: boolean;
  updateFrequency: string;
  status: string;
  trustLevel: number;
  qualityScore: number;
  note: string;
  tagIds: string[];
};

const EMPTY: SourceFormValues = {
  name: "",
  nameEn: "",
  providerId: "",
  providerName: "",
  description: "",
  officialUrl: "",
  endpointUrl: "",
  documentationUrl: "",
  category: "gis",
  dataFormat: "JSON",
  accessType: "API",
  requiresApiKey: false,
  apiKeyEnvName: "",
  licenseName: "",
  commercialUse: "unknown",
  attributionRequired: true,
  updateFrequency: "",
  status: "unknown",
  trustLevel: 3,
  qualityScore: 0,
  note: "",
  tagIds: [],
};

export function SourceForm({
  providers,
  tags,
  initialValues,
  sourceId,
}: {
  providers: ProviderOption[];
  tags: TagOption[];
  initialValues?: Partial<SourceFormValues>;
  sourceId?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SourceFormValues>({ ...EMPTY, ...initialValues });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        ...values,
        providerId: values.providerId || undefined,
        providerName: values.providerId ? undefined : values.providerName || undefined,
      };
      const res = await fetch(sourceId ? `/api/sources/${sourceId}` : "/api/sources", {
        method: sourceId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "入力内容を確認してください");
        return;
      }
      router.push(`/sources/${data.id}`);
      router.refresh();
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";
  const labelCls = "block text-xs font-medium text-slate-600 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="ds-name" className={labelCls}>📚 データソース名 *</label>
          <input id="ds-name" required className={inputCls} value={values.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>英語名</label>
          <input className={inputCls} value={values.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
        </div>
        <div>
          <label htmlFor="ds-providerId" className={labelCls}>🏛️ 提供元（既存から選択）*</label>
          <select id="ds-providerId" className={inputCls} value={values.providerId} onChange={(e) => set("providerId", e.target.value)}>
            <option value="">-- 新規提供元を入力 --</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>新規提供元名（既存未選択時）</label>
          <input
            className={inputCls}
            value={values.providerName}
            onChange={(e) => set("providerName", e.target.value)}
            disabled={!!values.providerId}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>📝 概要</label>
          <textarea rows={3} className={inputCls} value={values.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <label htmlFor="ds-officialUrl" className={labelCls}>🔗 公式URL *</label>
          <input id="ds-officialUrl" required type="url" className={inputCls} value={values.officialUrl} onChange={(e) => set("officialUrl", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>🔌 APIエンドポイントURL</label>
          <input type="url" className={inputCls} value={values.endpointUrl} onChange={(e) => set("endpointUrl", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>📄 API仕様書URL</label>
          <input type="url" className={inputCls} value={values.documentationUrl} onChange={(e) => set("documentationUrl", e.target.value)} />
        </div>
        <div>
          <label htmlFor="ds-category" className={labelCls}>カテゴリ *</label>
          <select id="ds-category" className={inputCls} value={values.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ds-dataFormat" className={labelCls}>データ形式 *</label>
          <select id="ds-dataFormat" className={inputCls} value={values.dataFormat} onChange={(e) => set("dataFormat", e.target.value)}>
            {DATA_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ds-accessType" className={labelCls}>アクセス方式 *</label>
          <select id="ds-accessType" className={inputCls} value={values.accessType} onChange={(e) => set("accessType", e.target.value)}>
            {ACCESS_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>ステータス</label>
          <select className={inputCls} value={values.status} onChange={(e) => set("status", e.target.value)}>
            {SOURCE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>🔑 APIキー要否</label>
          <div className="flex items-center gap-4 py-1.5 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={values.requiresApiKey} onChange={(e) => set("requiresApiKey", e.target.checked)} />
              APIキーが必要
            </label>
          </div>
        </div>
        <div>
          <label className={labelCls}>APIキー環境変数名（値は保存しない）</label>
          <input
            className={inputCls}
            placeholder="ESTAT_APP_ID"
            value={values.apiKeyEnvName}
            onChange={(e) => set("apiKeyEnvName", e.target.value.toUpperCase())}
            disabled={!values.requiresApiKey}
          />
        </div>
        <div>
          <label className={labelCls}>📜 ライセンス名</label>
          <input className={inputCls} value={values.licenseName} onChange={(e) => set("licenseName", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>商用利用</label>
          <select className={inputCls} value={values.commercialUse} onChange={(e) => set("commercialUse", e.target.value)}>
            {COMMERCIAL_USE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>出典表記</label>
          <div className="flex items-center gap-4 py-1.5 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={values.attributionRequired}
                onChange={(e) => set("attributionRequired", e.target.checked)}
              />
              出典表記が必要
            </label>
          </div>
        </div>
        <div>
          <label className={labelCls}>更新頻度</label>
          <input className={inputCls} placeholder="daily / monthly / irregular" value={values.updateFrequency} onChange={(e) => set("updateFrequency", e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>⭐ 信頼度 (1〜5)</label>
          <input
            type="number"
            min={1}
            max={5}
            className={inputCls}
            value={values.trustLevel}
            onChange={(e) => set("trustLevel", Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelCls}>📊 品質スコア (0〜100)</label>
          <input
            type="number"
            min={0}
            max={100}
            className={inputCls}
            value={values.qualityScore}
            onChange={(e) => set("qualityScore", Number(e.target.value))}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>🏷️ タグ</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const checked = values.tagIds.includes(tag.id);
              return (
                <label
                  key={tag.id}
                  className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${
                    checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={checked}
                    onChange={(e) =>
                      set(
                        "tagIds",
                        e.target.checked
                          ? [...values.tagIds, tag.id]
                          : values.tagIds.filter((id) => id !== tag.id),
                      )
                    }
                  />
                  {tag.name}
                </label>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>備考</label>
          <textarea rows={2} className={inputCls} value={values.note} onChange={(e) => set("note", e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "⏳ 保存中..." : sourceId ? "💾 更新する" : "➕ 登録する"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
