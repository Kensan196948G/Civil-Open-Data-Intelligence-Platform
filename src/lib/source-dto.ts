import { sanitizeUrl } from "@/lib/url-safety";

type ProviderLike = {
  id: string;
  name: string;
  organizationType?: string | null;
  officialUrl?: string | null;
};

type TagJoinLike = {
  tag: {
    id: string;
    name: string;
    color?: string | null;
  };
};

type DataSourceLike = {
  id: string;
  providerId: string;
  name: string;
  nameEn?: string | null;
  description?: string | null;
  officialUrl: string;
  endpointUrl?: string | null;
  documentationUrl?: string | null;
  category: string;
  dataFormat: string;
  accessType: string;
  requiresApiKey: boolean;
  apiKeyEnvName?: string | null;
  licenseName?: string | null;
  commercialUse: string;
  attributionRequired: boolean;
  updateFrequency?: string | null;
  lastCheckedAt?: Date | string | null;
  status: string;
  trustLevel: number;
  qualityScore: number;
  note?: string | null;
  updatedBy?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  provider?: ProviderLike;
  tags?: TagJoinLike[];
};

export function safeProviderDto(provider: ProviderLike) {
  return {
    ...provider,
    officialUrl: provider.officialUrl ? sanitizeUrl(provider.officialUrl) : provider.officialUrl,
  };
}

export function safeSourceDto<T extends DataSourceLike>(source: T, options: { includeSensitive?: boolean } = {}) {
  const { includeSensitive = false } = options;
  const base = {
    ...source,
    officialUrl: sanitizeUrl(source.officialUrl),
    endpointUrl: source.endpointUrl ? sanitizeUrl(source.endpointUrl) : source.endpointUrl,
    documentationUrl: source.documentationUrl
      ? sanitizeUrl(source.documentationUrl)
      : source.documentationUrl,
    provider: source.provider ? safeProviderDto(source.provider) : source.provider,
    tags: source.tags?.map((item) => ({
      tag: {
        ...item.tag,
      },
    })),
  };

  if (includeSensitive) return base;

  const { apiKeyEnvName: _apiKeyEnvName, note: _note, updatedBy: _updatedBy, ...publicSource } = base;
  void _apiKeyEnvName;
  void _note;
  void _updatedBy;
  return publicSource;
}
