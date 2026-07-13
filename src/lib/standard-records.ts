import { Prisma as PostgreSQLPrisma } from "../../node_modules/.prisma/client-postgresql";
import { prisma } from "@/lib/db";
import { isPostgreSqlDatabase } from "@/lib/database-url";
import { sanitizeUrl } from "@/lib/url-safety";
import { toIso } from "@/lib/v1-response";

const SECRET_PROPERTY_KEY =
  /(api[-_]?key|apikey|app[_-]?id|authorization|bearer|client[-_]?secret|credential|internal|note|password|secret|token)/i;

type RawStandardRecord = {
  recordId: string;
  sourceId: string;
  sourceRecordId: string;
  category: string;
  title: string;
  description: string | null;
  prefectureCode: string | null;
  municipalityCode: string | null;
  address: string | null;
  geometryGeoJson: string | null;
  observedAt: Date | string | null;
  publishedAt: Date | string | null;
  retrievedAt: Date | string;
  validFrom: Date | string | null;
  validTo: Date | string | null;
  sourceUrl: string;
  licenseId: string | null;
  qualityStatus: string;
  rawDataReference: string | null;
  properties: unknown;
  dataSourceTitle: string;
  dataSourceStatus: string;
  dataSourceQualityScore: number;
  providerId: string;
  providerName: string;
  providerOrganizationType: string;
};

type RawLayer = {
  layerId: string;
  sourceId: string;
  title: string;
  description: string | null;
  category: string;
  dataFormat: string;
  accessType: string;
  sourceUrl: string;
  licenseId: string | null;
  qualityScore: number;
  status: string;
  updatedAt: Date | string;
  lastCheckedAt: Date | string | null;
  providerId: string;
  providerName: string;
  providerOrganizationType: string;
  attributionRequired: boolean;
  commercialUse: string;
  featureCount: number | bigint;
  bbox: unknown;
};

export type StandardRecordQueryResult = {
  records: ReturnType<typeof standardRecordDto>[];
  total: number;
  nextCursor: string | null;
  standardized: true;
};

export type StandardLayerQueryResult = {
  layers: ReturnType<typeof standardLayerDto>[];
  total: number;
  nextCursor: string | null;
  standardized: true;
};

export type StandardFeatureCollectionResult = {
  features: {
    type: "Feature";
    id: string;
    geometry: unknown;
    properties: Record<string, unknown>;
  }[];
  metadata: {
    featureCount: number;
    bbox: number[] | null;
    nextCursor: string | null;
    truncated: boolean;
  };
  standardized: true;
};

let standardRecordsAvailableCache: boolean | null = null;

function parseJson(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function parseBbox(value: unknown): number[] | null {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length !== 4) return null;
  const numbers = parsed.map((item) => Number(item));
  return numbers.every(Number.isFinite) ? numbers : null;
}

function safePropertyValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[omitted]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.slice(0, 500);
    return /^https?:\/\//i.test(trimmed) ? sanitizeUrl(trimmed) : trimmed;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safePropertyValue(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 50)) {
      if (SECRET_PROPERTY_KEY.test(key)) continue;
      result[key] = safePropertyValue(nested, depth + 1);
    }
    return result;
  }
  return String(value).slice(0, 200);
}

function safeProperties(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  const safe = safePropertyValue(parsed);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as Record<string, unknown>) : {};
}

function extendBboxFromCoordinates(value: unknown, bbox: [number, number, number, number]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    const lng = value[0];
    const lat = value[1];
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      bbox[0] = Math.min(bbox[0], lng);
      bbox[1] = Math.min(bbox[1], lat);
      bbox[2] = Math.max(bbox[2], lng);
      bbox[3] = Math.max(bbox[3], lat);
    }
    return;
  }
  for (const item of value) extendBboxFromCoordinates(item, bbox);
}

function bboxFromGeometries(geometries: unknown[]) {
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const geometry of geometries) {
    if (!geometry || typeof geometry !== "object" || !("coordinates" in geometry)) continue;
    extendBboxFromCoordinates((geometry as { coordinates?: unknown }).coordinates, bbox);
  }
  return bbox.every(Number.isFinite) ? bbox : null;
}

export function resetStandardRecordsAvailabilityForTests() {
  standardRecordsAvailableCache = null;
}

export async function standardRecordsAvailable() {
  if (!isPostgreSqlDatabase()) return false;
  // true は恒久的な状態としてキャッシュしてよいが、false(未投入)は後続の取り込みで
  // true に変わりうるため毎回再評価する(空結果を永続キャッシュしない)
  if (standardRecordsAvailableCache) return true;
  const rows = await prisma.$queryRaw<{ count: number | bigint }[]>`
    SELECT COUNT(*)::int AS "count" FROM "standard_records"
  `;
  standardRecordsAvailableCache = Number(rows[0]?.count ?? 0) > 0;
  return standardRecordsAvailableCache;
}

function standardRecordDto(row: RawStandardRecord) {
  const sourceUrl = sanitizeUrl(row.sourceUrl);
  return {
    recordId: row.recordId,
    sourceId: row.sourceId,
    sourceRecordId: row.sourceRecordId,
    category: row.category,
    title: row.title,
    description: row.description,
    prefectureCode: row.prefectureCode,
    municipalityCode: row.municipalityCode,
    address: row.address,
    geometry: parseJson(row.geometryGeoJson),
    observedAt: toIso(row.observedAt),
    publishedAt: toIso(row.publishedAt),
    retrievedAt: toIso(row.retrievedAt),
    validFrom: toIso(row.validFrom),
    validTo: toIso(row.validTo),
    sourceUrl,
    licenseId: row.licenseId,
    qualityStatus: row.qualityStatus,
    rawDataReference: row.rawDataReference,
    properties: {
      ...safeProperties(row.properties),
      provider: {
        id: row.providerId,
        name: row.providerName,
        organizationType: row.providerOrganizationType,
      },
      dataSource: {
        id: row.sourceId,
        title: row.dataSourceTitle,
        status: row.dataSourceStatus,
        qualityScore: row.dataSourceQualityScore,
      },
    },
  };
}

function standardLayerDto(row: RawLayer) {
  return {
    layerId: row.layerId,
    sourceId: row.sourceId,
    title: row.title,
    description: row.description,
    category: row.category,
    dataFormat: row.dataFormat,
    accessType: row.accessType,
    sourceUrl: sanitizeUrl(row.sourceUrl),
    licenseId: row.licenseId,
    qualityStatus: row.status === "active" && row.qualityScore >= 80 ? "usable" : "needs_review",
    qualityScore: row.qualityScore,
    status: row.status,
    updatedAt: toIso(row.updatedAt),
    lastCheckedAt: toIso(row.lastCheckedAt),
    retrievedAt: toIso(row.lastCheckedAt ?? row.updatedAt),
    featuresUrl: `/api/v1/layers/${row.sourceId}/features`,
    provider: {
      id: row.providerId,
      name: row.providerName,
      organizationType: row.providerOrganizationType,
    },
    attributionRequired: row.attributionRequired,
    commercialUse: row.commercialUse,
    tags: [],
    dataAvailability: "standard_records",
    geometryStatus: "standardized",
    featureCount: Number(row.featureCount),
    bbox: parseBbox(row.bbox),
    capabilities: {
      format: "geojson",
      bbox: true,
      standardizedFeatures: true,
    },
  };
}

function standardRecordSelectSql() {
  return PostgreSQLPrisma.sql`
    sr.id AS "recordId",
    sr."dataSourceId" AS "sourceId",
    COALESCE(sr."sourceRecordId", sr.id) AS "sourceRecordId",
    sr.category AS "category",
    sr.title AS "title",
    sr.description AS "description",
    sr."prefectureCode" AS "prefectureCode",
    sr."municipalityCode" AS "municipalityCode",
    sr.address AS "address",
    ST_AsGeoJSON(sr.geometry) AS "geometryGeoJson",
    sr."observedAt" AS "observedAt",
    sr."publishedAt" AS "publishedAt",
    sr."retrievedAt" AS "retrievedAt",
    sr."validFrom" AS "validFrom",
    sr."validTo" AS "validTo",
    COALESCE(sr."sourceUrl", ds."officialUrl") AS "sourceUrl",
    sr."licenseId" AS "licenseId",
    sr."qualityStatus" AS "qualityStatus",
    sr."rawDataReference" AS "rawDataReference",
    sr.properties AS "properties",
    ds.name AS "dataSourceTitle",
    ds.status AS "dataSourceStatus",
    ds."qualityScore" AS "dataSourceQualityScore",
    p.id AS "providerId",
    p.name AS "providerName",
    p."organizationType" AS "providerOrganizationType"
  `;
}

export async function findStandardRecordsForSearch(input: {
  q?: string;
  category?: string;
  updatedSince?: Date;
  limit: number;
  cursor: number;
}): Promise<StandardRecordQueryResult | null> {
  if (!(await standardRecordsAvailable())) return null;

  const where: PostgreSQLPrisma.Sql[] = [];
  if (input.q) {
    const q = `%${input.q}%`;
    where.push(
      PostgreSQLPrisma.sql`(sr.title ILIKE ${q} OR sr.description ILIKE ${q} OR sr.address ILIKE ${q} OR sr."sourceRecordId" ILIKE ${q})`,
    );
  }
  if (input.category) where.push(PostgreSQLPrisma.sql`sr.category = ${input.category}`);
  if (input.updatedSince) where.push(PostgreSQLPrisma.sql`sr."updatedAt" >= ${input.updatedSince}`);
  const whereSql =
    where.length > 0
      ? PostgreSQLPrisma.sql`WHERE ${PostgreSQLPrisma.join(where, " AND ")}`
      : PostgreSQLPrisma.empty;

  const countRows = await prisma.$queryRaw<{ count: number | bigint }[]>`
    SELECT COUNT(*)::int AS "count"
    FROM "standard_records" sr
    ${whereSql}
  `;
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await prisma.$queryRaw<RawStandardRecord[]>`
    SELECT ${standardRecordSelectSql()}
    FROM "standard_records" sr
    JOIN "data_sources" ds ON ds.id = sr."dataSourceId"
    JOIN "providers" p ON p.id = ds."providerId"
    ${whereSql}
    ORDER BY sr."updatedAt" DESC, sr.id ASC
    LIMIT ${input.limit}
    OFFSET ${input.cursor}
  `;

  return {
    records: rows.map(standardRecordDto),
    total,
    nextCursor: input.cursor + rows.length < total ? String(input.cursor + rows.length) : null,
    standardized: true,
  };
}

export async function findStandardRecordsForPoint(input: {
  lat: number;
  lng: number;
  radiusM: number;
  categories: string[];
}): Promise<StandardRecordQueryResult | null> {
  if (!(await standardRecordsAvailable())) return null;

  const categorySql =
    input.categories.length > 0
      ? PostgreSQLPrisma.sql`AND sr.category IN (${PostgreSQLPrisma.join(input.categories)})`
      : PostgreSQLPrisma.empty;

  const rows = await prisma.$queryRaw<RawStandardRecord[]>`
    SELECT ${standardRecordSelectSql()}
    FROM "standard_records" sr
    JOIN "data_sources" ds ON ds.id = sr."dataSourceId"
    JOIN "providers" p ON p.id = ds."providerId"
    WHERE sr.geometry IS NOT NULL
      AND ST_DWithin(
        sr.geometry::geography,
        ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
        ${input.radiusM}
      )
      ${categorySql}
    ORDER BY ST_Distance(
      sr.geometry::geography,
      ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography
    ) ASC, sr.id ASC
    LIMIT 50
  `;

  return {
    records: rows.map(standardRecordDto),
    total: rows.length,
    nextCursor: null,
    standardized: true,
  };
}

export async function findStandardLayers(input: {
  q?: string;
  category?: string;
  limit: number;
  cursor: number;
}): Promise<StandardLayerQueryResult | null> {
  if (!(await standardRecordsAvailable())) return null;

  const where: PostgreSQLPrisma.Sql[] = [];
  if (input.q) {
    const q = `%${input.q}%`;
    where.push(PostgreSQLPrisma.sql`(ds.name ILIKE ${q} OR ds."nameEn" ILIKE ${q} OR ds.description ILIKE ${q})`);
  }
  if (input.category) where.push(PostgreSQLPrisma.sql`ds.category = ${input.category}`);
  const whereSql =
    where.length > 0
      ? PostgreSQLPrisma.sql`WHERE ${PostgreSQLPrisma.join(where, " AND ")}`
      : PostgreSQLPrisma.empty;

  const countRows = await prisma.$queryRaw<{ count: number | bigint }[]>`
    SELECT COUNT(*)::int AS "count"
    FROM (
      SELECT ds.id
      FROM "data_sources" ds
      JOIN "standard_records" sr ON sr."dataSourceId" = ds.id
      ${whereSql}
      GROUP BY ds.id
    ) grouped_layers
  `;
  const total = Number(countRows[0]?.count ?? 0);

  const rows = await prisma.$queryRaw<RawLayer[]>`
    SELECT
      ds.id AS "layerId",
      ds.id AS "sourceId",
      ds.name AS "title",
      ds.description AS "description",
      ds.category AS "category",
      ds."dataFormat" AS "dataFormat",
      ds."accessType" AS "accessType",
      ds."officialUrl" AS "sourceUrl",
      ds."licenseName" AS "licenseId",
      ds."qualityScore" AS "qualityScore",
      ds.status AS "status",
      ds."updatedAt" AS "updatedAt",
      ds."lastCheckedAt" AS "lastCheckedAt",
      ds."attributionRequired" AS "attributionRequired",
      ds."commercialUse" AS "commercialUse",
      p.id AS "providerId",
      p.name AS "providerName",
      p."organizationType" AS "providerOrganizationType",
      COUNT(sr.id)::int AS "featureCount",
      CASE
        WHEN COUNT(sr.geometry) > 0 THEN json_build_array(
          ST_XMin(ST_Extent(sr.geometry)),
          ST_YMin(ST_Extent(sr.geometry)),
          ST_XMax(ST_Extent(sr.geometry)),
          ST_YMax(ST_Extent(sr.geometry))
        )
        ELSE NULL
      END AS "bbox"
    FROM "data_sources" ds
    JOIN "providers" p ON p.id = ds."providerId"
    JOIN "standard_records" sr ON sr."dataSourceId" = ds.id
    ${whereSql}
    GROUP BY ds.id, p.id
    ORDER BY ds."updatedAt" DESC, ds.id ASC
    LIMIT ${input.limit}
    OFFSET ${input.cursor}
  `;

  return {
    layers: rows.map(standardLayerDto),
    total,
    nextCursor: input.cursor + rows.length < total ? String(input.cursor + rows.length) : null,
    standardized: true,
  };
}

export async function findStandardFeaturesForLayer(input: {
  sourceId: string;
  bbox?: [number, number, number, number];
  limit: number;
  cursor: number;
}): Promise<StandardFeatureCollectionResult | null> {
  if (!(await standardRecordsAvailable())) return null;

  const sourceCount = await prisma.$queryRaw<{ count: number | bigint }[]>`
    SELECT COUNT(*)::int AS "count"
    FROM "standard_records"
    WHERE "dataSourceId" = ${input.sourceId}
  `;
  if (Number(sourceCount[0]?.count ?? 0) === 0) return null;

  const bboxSql = input.bbox
    ? PostgreSQLPrisma.sql`AND sr.geometry && ST_MakeEnvelope(${input.bbox[0]}, ${input.bbox[1]}, ${input.bbox[2]}, ${input.bbox[3]}, 4326)
        AND ST_Intersects(sr.geometry, ST_MakeEnvelope(${input.bbox[0]}, ${input.bbox[1]}, ${input.bbox[2]}, ${input.bbox[3]}, 4326))`
    : PostgreSQLPrisma.empty;

  const rows = await prisma.$queryRaw<RawStandardRecord[]>`
    SELECT ${standardRecordSelectSql()}
    FROM "standard_records" sr
    JOIN "data_sources" ds ON ds.id = sr."dataSourceId"
    JOIN "providers" p ON p.id = ds."providerId"
    WHERE sr."dataSourceId" = ${input.sourceId}
      AND sr.geometry IS NOT NULL
      ${bboxSql}
    ORDER BY sr."updatedAt" DESC, sr.id ASC
    LIMIT ${input.limit + 1}
    OFFSET ${input.cursor}
  `;

  const visibleRows = rows.slice(0, input.limit);
  const features = visibleRows.map((row) => {
    const record = standardRecordDto(row);
    return {
      type: "Feature" as const,
      id: record.recordId,
      geometry: record.geometry,
      properties: {
        ...safeProperties(row.properties),
        recordId: record.recordId,
        sourceId: record.sourceId,
        sourceRecordId: record.sourceRecordId,
        category: record.category,
        title: record.title,
        description: record.description,
        address: record.address,
        observedAt: record.observedAt,
        publishedAt: record.publishedAt,
        retrievedAt: record.retrievedAt,
        sourceUrl: record.sourceUrl,
        licenseId: record.licenseId,
        qualityStatus: record.qualityStatus,
      },
    };
  });

  return {
    features,
    metadata: {
      featureCount: features.length,
      bbox: bboxFromGeometries(features.map((feature) => feature.geometry)),
      nextCursor: rows.length > input.limit ? String(input.cursor + input.limit) : null,
      truncated: rows.length > input.limit,
    },
    standardized: true,
  };
}
