export type RecommendationCandidate = {
  id: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  category: string;
  dataFormat: string;
  accessType: string;
  officialUrl: string;
  documentationUrl: string | null;
  endpointUrl: string | null;
  licenseName: string | null;
  commercialUse: string;
  updateFrequency: string | null;
  lastCheckedAt: Date | null;
  status: string;
  qualityScore: number;
  tags: { tag: { id: string; name: string; color: string | null } }[];
  relatedUseCases: { useCaseName: string; targetSystem: string | null; description: string | null }[];
};

const CONSTRUCTION_KEYWORDS = [
  "工事",
  "施工",
  "防災",
  "河川",
  "道路",
  "橋梁",
  "浸水",
  "斜面",
  "標高",
  "洪水",
  "津波",
  "土砂",
  "都市計画",
  "避難",
  "病院",
  "交通",
  "インフラ",
  "地震",
  "気象",
  "水位",
];

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[\s、。・,，／/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function tagNames(source: RecommendationCandidate): string[] {
  return source.tags.map((item) => item.tag.name.toLowerCase());
}

function reasonsFor(source: RecommendationCandidate, tokens: string[]): string[] {
  const reasons: string[] = [];
  const haystack = [
    source.name.toLowerCase(),
    (source.nameEn ?? "").toLowerCase(),
    (source.description ?? "").toLowerCase(),
    source.category.toLowerCase(),
    source.relatedUseCases.map((item) => item.useCaseName.toLowerCase()).join(" "),
    ...tagNames(source),
  ].join(" ");
  const matched = tokens.filter((token) => haystack.includes(token));
  if (matched.length > 0) {
    reasons.push(`入力語「${matched.join("」「")}」とデータ内容が一致`);
  }
  if (source.qualityScore >= 80 && source.status === "active") {
    reasons.push("品質スコア80以上かつ稼働中");
  }
  if (source.updateFrequency) {
    reasons.push(`更新頻度: ${source.updateFrequency}`);
  }
  if (source.relatedUseCases.length > 0) {
    reasons.push(`想定利用: ${source.relatedUseCases[0].useCaseName}`);
  }
  return reasons;
}

export function scoreDataSources(sources: RecommendationCandidate[], query: string, limit = 5) {
  const tokens = tokenize(query);
  const scored = sources
    .map((source) => {
      let score = 0;
      const name = source.name.toLowerCase();
      const nameEn = (source.nameEn ?? "").toLowerCase();
      const description = (source.description ?? "").toLowerCase();
      const category = source.category.toLowerCase();
      const tags = tagNames(source);
      const useCases = source.relatedUseCases.map((item) => item.useCaseName.toLowerCase());
      for (const token of tokens) {
        if (name === token) score += 12;
        else if (name.includes(token)) score += 6;
        if (nameEn.includes(token)) score += 4;
        if (category.includes(token)) score += 4;
        if (tags.some((tag) => tag.includes(token))) score += 6;
        if (useCases.some((useCase) => useCase.includes(token))) score += 5;
        if (description.includes(token)) score += 1;
      }
      for (const keyword of CONSTRUCTION_KEYWORDS) {
        if (tokens.includes(keyword.toLowerCase())) {
          score += 3;
        }
      }
      return { source, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.source.qualityScore - a.source.qualityScore)
    .slice(0, limit);

  return scored.map(({ source, score }) => ({
    sourceId: source.id,
    title: source.name,
    description: source.description,
    category: source.category,
    dataFormat: source.dataFormat,
    accessType: source.accessType,
    sourceUrl: source.officialUrl,
    documentationUrl: source.documentationUrl,
    endpointUrl: source.endpointUrl,
    licenseName: source.licenseName,
    commercialUse: source.commercialUse,
    updateFrequency: source.updateFrequency,
    lastCheckedAt: source.lastCheckedAt,
    status: source.status,
    qualityScore: source.qualityScore,
    tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
    relatedUseCases: source.relatedUseCases.map((item) => ({
      useCaseName: item.useCaseName,
      targetSystem: item.targetSystem,
      description: item.description,
    })),
    score,
    reasons: reasonsFor(source, tokens),
    mapLayerUrl:
      source.dataFormat === "GeoJSON" || source.dataFormat === "Shapefile" || source.dataFormat === "CityGML"
        ? `/api/v1/layers/${source.id}/features`
        : null,
  }));
}
