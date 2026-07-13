#!/usr/bin/env node

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function fetchWithTimeout(url, init = {}) {
  const timeoutMs = Number(process.env.CODIP_SMOKE_TIMEOUT_MS ?? "10000");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, init) {
  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

function requireStatus(checks, name, actual, expected) {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  checks.push({ name, ok, detail: `status=${actual}, expected=${expected}` });
}

function requireHeader(checks, headers, name) {
  checks.push({
    name: `header:${name}`,
    ok: Boolean(headers.get(name)),
    detail: headers.get(name) ?? "missing",
  });
}

function requireCondition(checks, name, ok, detail) {
  checks.push({ name, ok, detail });
}

function firstCoordinateFromGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  const visit = (value) => {
    if (!Array.isArray(value)) return null;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number" &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      return { lng: value[0], lat: value[1] };
    }
    for (const item of value) {
      const found = visit(item);
      if (found) return found;
    }
    return null;
  };
  return visit(geometry.coordinates);
}

async function main() {
  const baseUrl = argValue("--base-url", process.env.CODIP_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
  const readOnly = process.argv.includes("--read-only");
  const expectStandardRecords =
    process.argv.includes("--expect-standard-records") || process.env.CODIP_EXPECT_STANDARD_RECORDS === "true";
  const expectSeedStandardRecord =
    process.argv.includes("--expect-seed-standard-record") || process.env.CODIP_EXPECT_SEED_STANDARD_RECORD === "true";
  const checks = [];

  for (const path of ["/", "/sources", "/settings", "/map", "/logs"]) {
    const response = await fetchWithTimeout(`${baseUrl}${path}`, { method: "GET" });
    requireStatus(checks, `page:${path}`, response.status, 200);
  }

  const dashboardPage = await fetchWithTimeout(`${baseUrl}/`);
  const dashboardHtml = await dashboardPage.text();
  requireCondition(
    checks,
    "public ui:dashboard management link absent",
    !dashboardHtml.includes('href="/sources/new"'),
    dashboardHtml.slice(0, 200),
  );
  requireCondition(
    checks,
    "a11y:skip link present",
    dashboardHtml.includes('href="#main-content"') && dashboardHtml.includes('id="main-content"'),
    dashboardHtml.slice(0, 400),
  );
  requireCondition(
    checks,
    "a11y:current nav present",
    dashboardHtml.includes('aria-current="page"'),
    dashboardHtml.slice(0, 400),
  );

  const sourcesPage = await fetchWithTimeout(`${baseUrl}/sources`);
  const sourcesHtml = await sourcesPage.text();
  requireCondition(
    checks,
    "public ui:sources management link absent",
    !sourcesHtml.includes('href="/sources/new"'),
    sourcesHtml.slice(0, 200),
  );

  const tagsPage = await fetchWithTimeout(`${baseUrl}/tags`);
  const tagsHtml = await tagsPage.text();
  requireStatus(checks, "page:/tags", tagsPage.status, 200);
  requireCondition(
    checks,
    "public ui:tags add form absent",
    !tagsHtml.includes("タグ追加") && !tagsHtml.includes('name="name"'),
    tagsHtml.slice(0, 200),
  );

  const logsPage = await fetchWithTimeout(`${baseUrl}/logs`);
  const logsHtml = await logsPage.text();
  requireStatus(checks, "page:/logs", logsPage.status, 200);
  requireCondition(
    checks,
    "public ui:logs admin-only message visible",
    logsHtml.includes("管理者のみ表示します") && !logsHtml.includes("条件に一致する取得ログ"),
    logsHtml.slice(0, 200),
  );

  const rootHead = await fetchWithTimeout(`${baseUrl}/`, { method: "HEAD" });
  requireStatus(checks, "page:/ HEAD", rootHead.status, 200);
  for (const header of [
    "content-security-policy",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security",
  ]) {
    requireHeader(checks, rootHead.headers, header);
  }
  const csp = rootHead.headers.get("content-security-policy") ?? "";
  requireCondition(
    checks,
    "header:csp value",
    csp.includes("default-src 'self'") &&
      csp.includes("object-src 'none'") &&
      csp.includes("frame-ancestors 'none'") &&
      csp.includes("https://cyberjapandata.gsi.go.jp") &&
      !csp.includes("'unsafe-eval'"),
    csp,
  );
  const hsts = rootHead.headers.get("strict-transport-security") ?? "";
  requireCondition(
    checks,
    "header:hsts value",
    hsts.includes("max-age=") && hsts.includes("includeSubDomains"),
    hsts,
  );

  const health = await fetchJson(`${baseUrl}/api/health`);
  requireStatus(checks, "api:/api/health", health.response.status, 200);
  requireCondition(checks, "health status", health.json?.status === "ok", JSON.stringify(health.json));

  const ready = await fetchJson(`${baseUrl}/api/ready`);
  requireStatus(checks, "api:/api/ready", ready.response.status, 200);
  requireCondition(checks, "ready status", ready.json?.status === "ready", JSON.stringify(ready.json));

  const openapi = await fetchJson(`${baseUrl}/api/openapi`);
  requireStatus(checks, "api:/api/openapi", openapi.response.status, 200);
  requireCondition(checks, "openapi version", openapi.json?.openapi === "3.1.0", openapi.text.slice(0, 200));
  const openapiSchemas = openapi.json?.components?.schemas ?? {};
  requireCondition(
    checks,
    "openapi v1 schemas",
    Boolean(
      openapiSchemas.V1ErrorResponse &&
        openapiSchemas.V1Warning &&
        openapiSchemas.V1StandardRecord &&
        openapiSchemas.V1RecordsSearchResponse &&
        openapiSchemas.V1PointResponse &&
        openapiSchemas.V1FreshnessResponse &&
        openapiSchemas.V1LayersResponse &&
        openapiSchemas.V1FeatureCollectionResponse,
    ),
    openapi.text.slice(0, 200),
  );
  requireCondition(
    checks,
    "openapi v1 error refs",
    openapi.json?.paths?.["/api/v1/records/point"]?.get?.responses?.["400"]?.content?.[
      "application/json"
    ]?.schema?.$ref === "#/components/schemas/V1ErrorResponse" &&
      openapi.json?.paths?.["/api/v1/layers/{id}/features"]?.get?.responses?.["404"]?.content?.[
        "application/json"
      ]?.schema?.$ref === "#/components/schemas/V1ErrorResponse",
    openapi.text.slice(0, 200),
  );
  const standardRecordRequired = openapiSchemas.V1StandardRecord?.required ?? [];
  const recordsItemRef =
    openapiSchemas.V1RecordsSearchResponse?.properties?.data?.properties?.records?.items?.$ref;
  requireCondition(
    checks,
    "openapi v1 standard record schema",
    [
      "recordId",
      "sourceId",
      "sourceRecordId",
      "category",
      "title",
      "geometry",
      "retrievedAt",
      "sourceUrl",
      "licenseId",
      "qualityStatus",
      "properties",
    ].every((field) => standardRecordRequired.includes(field)) &&
      recordsItemRef === "#/components/schemas/V1StandardRecord",
    openapi.text.slice(0, 200),
  );

  const sources = await fetchJson(`${baseUrl}/api/sources?take=1`);
  requireStatus(checks, "api:/api/sources", sources.response.status, 200);
  requireCondition(checks, "sources payload", Array.isArray(sources.json?.items), sources.text.slice(0, 200));
  const firstSource = sources.json?.items?.[0];
  requireCondition(
    checks,
    "sources public sensitive fields absent",
    firstSource &&
      !("apiKeyEnvName" in firstSource) &&
      !("note" in firstSource) &&
      !("updatedBy" in firstSource),
    sources.text.slice(0, 200),
  );
  requireCondition(
    checks,
    "sources seed count",
    typeof sources.json?.total === "number" && sources.json.total >= 20,
    sources.text.slice(0, 200),
  );

  const v1Records = await fetchJson(`${baseUrl}/api/v1/records/search?limit=1`);
  requireStatus(checks, "api:/api/v1/records/search", v1Records.response.status, 200);
  requireCondition(
    checks,
    "v1 records payload",
    Array.isArray(v1Records.json?.data?.records) && Boolean(v1Records.json?.meta?.requestId),
    v1Records.text.slice(0, 200),
  );
  const firstRecordsWarning = v1Records.json?.warnings?.[0];
  requireCondition(
    checks,
    "v1 records warning contract",
    Array.isArray(v1Records.json?.warnings) &&
      typeof firstRecordsWarning?.code === "string" &&
      typeof firstRecordsWarning?.severity === "string" &&
      typeof firstRecordsWarning?.message === "string",
    v1Records.text.slice(0, 200),
  );

  const firstV1Record = v1Records.json?.data?.records?.[0];
  requireCondition(checks, "v1 records first source", Boolean(firstV1Record?.sourceId), v1Records.text.slice(0, 200));
  const recordsMode = v1Records.json?.meta?.mode;
  if (expectStandardRecords) {
    requireCondition(
      checks,
      "v1 records standard_records mode",
      recordsMode === "standard_records" && !String(firstV1Record?.recordId ?? "").startsWith("catalog:"),
      v1Records.text.slice(0, 300),
    );
  }
  if (expectSeedStandardRecord) {
    const seedRecords = await fetchJson(`${baseUrl}/api/v1/records/search?q=${encodeURIComponent("東京駅")}&limit=10`);
    const seedRecord = seedRecords.json?.data?.records?.find(
      (record) => record?.recordId === "std_seed_tokyo_station_risk_sample",
    );
    requireCondition(
      checks,
      "v1 seed standard record sanitized",
      seedRecords.json?.meta?.mode === "standard_records" &&
        seedRecord?.geometry?.type === "Point" &&
        seedRecord?.properties?.apiToken === undefined &&
        seedRecord?.properties?.internalNote === undefined,
      seedRecords.text.slice(0, 300),
    );
  }
  requireCondition(
    checks,
    "v1 records contract fields",
    Boolean(firstV1Record?.sourceUrl) &&
      typeof firstV1Record?.licenseId !== "undefined" &&
      typeof firstV1Record?.qualityStatus === "string" &&
      typeof firstV1Record?.properties?.provider?.name === "string",
    v1Records.text.slice(0, 200),
  );

  const freshness = await fetchJson(`${baseUrl}/api/v1/sources/${firstV1Record?.sourceId}/freshness`);
  requireStatus(checks, "api:/api/v1/sources/{id}/freshness", freshness.response.status, 200);
  requireCondition(
    checks,
    "v1 freshness payload",
    freshness.json?.data?.sourceId === firstV1Record?.sourceId &&
      typeof freshness.json?.data?.qualityStatus === "string" &&
      typeof freshness.json?.data?.consecutiveFailureCount === "number" &&
      Boolean(freshness.json?.meta?.requestId),
    freshness.text.slice(0, 200),
  );
  const firstFreshnessWarning = freshness.json?.warnings?.[0];
  requireCondition(
    checks,
    "v1 freshness warning contract",
    Array.isArray(freshness.json?.warnings) &&
      typeof firstFreshnessWarning?.code === "string" &&
      typeof firstFreshnessWarning?.severity === "string" &&
      typeof firstFreshnessWarning?.message === "string",
    freshness.text.slice(0, 200),
  );

  const layers = await fetchJson(`${baseUrl}/api/v1/layers?limit=1`);
  requireStatus(checks, "api:/api/v1/layers", layers.response.status, 200);
  requireCondition(
    checks,
    "v1 layers payload",
    Array.isArray(layers.json?.data?.layers) && Boolean(layers.json?.meta?.requestId),
    layers.text.slice(0, 200),
  );
  const firstLayer = layers.json?.data?.layers?.[0];
  requireCondition(checks, "v1 layers first layer", Boolean(firstLayer?.layerId), layers.text.slice(0, 200));
  const layersMode = layers.json?.meta?.mode;
  requireCondition(
    checks,
    "v1 layers contract fields",
    (firstLayer?.dataAvailability === "catalog_only" || firstLayer?.dataAvailability === "standard_records") &&
      (firstLayer?.geometryStatus === "not_standardized" || firstLayer?.geometryStatus === "standardized") &&
      typeof firstLayer?.featuresUrl === "string",
    layers.text.slice(0, 200),
  );
  if (expectStandardRecords) {
    requireCondition(
      checks,
      "v1 layers standard_records mode",
      layersMode === "standard_records_layers" &&
        firstLayer?.dataAvailability === "standard_records" &&
        firstLayer?.geometryStatus === "standardized" &&
        firstLayer?.capabilities?.standardizedFeatures === true &&
        Number(firstLayer?.featureCount) >= 1 &&
        Array.isArray(firstLayer?.bbox),
      layers.text.slice(0, 300),
    );
  }
  const firstLayersWarning = layers.json?.warnings?.[0];
  requireCondition(
    checks,
    "v1 layers warning contract",
    Array.isArray(layers.json?.warnings) &&
      typeof firstLayersWarning?.code === "string" &&
      typeof firstLayersWarning?.severity === "string" &&
      typeof firstLayersWarning?.message === "string",
    layers.text.slice(0, 200),
  );

  const features = await fetchJson(`${baseUrl}/api/v1/layers/${firstLayer?.layerId}/features`);
  requireStatus(checks, "api:/api/v1/layers/{id}/features", features.response.status, 200);
  requireCondition(
    checks,
    "v1 layer features payload",
    features.json?.type === "FeatureCollection" &&
      Array.isArray(features.json?.features) &&
      features.json?.metadata?.layerId === firstLayer?.layerId &&
      (features.json?.metadata?.dataAvailability === "catalog_only" ||
        features.json?.metadata?.dataAvailability === "standard_records") &&
      (features.json?.metadata?.geometryStatus === "not_standardized" ||
        features.json?.metadata?.geometryStatus === "standardized"),
    features.text.slice(0, 200),
  );
  if (expectStandardRecords) {
    const firstFeature = features.json?.features?.[0];
    requireCondition(
      checks,
      "v1 layer features standard_records payload",
      features.json?.metadata?.mode === "standard_records_features" &&
        features.json?.metadata?.standardizedFeatures === true &&
        features.json?.metadata?.dataAvailability === "standard_records" &&
        features.json?.metadata?.geometryStatus === "standardized" &&
        firstFeature?.type === "Feature" &&
        Boolean(firstCoordinateFromGeometry(firstFeature?.geometry)) &&
        firstFeature?.properties?.apiToken === undefined &&
        firstFeature?.properties?.internalNote === undefined,
      features.text.slice(0, 300),
    );
  }

  const standardPoint = expectStandardRecords
    ? firstCoordinateFromGeometry(features.json?.features?.[0]?.geometry)
    : null;
  const pointLat = standardPoint?.lat ?? 35.681236;
  const pointLng = standardPoint?.lng ?? 139.767125;
  const point = await fetchJson(`${baseUrl}/api/v1/records/point?lat=${pointLat}&lng=${pointLng}&radiusM=1000`);
  requireStatus(checks, "api:/api/v1/records/point", point.response.status, 200);
  const pointEvaluation = point.json?.data?.spatialEvaluation;
  requireCondition(
    checks,
    "v1 point payload",
    (pointEvaluation?.status === "not_available" || pointEvaluation?.status === "evaluated") &&
      typeof pointEvaluation?.evaluated === "boolean" &&
      Array.isArray(point.json?.data?.records) &&
      Array.isArray(point.json?.data?.candidateLayers) &&
      (point.json?.data?.dataAvailability === "catalog_only" ||
        point.json?.data?.dataAvailability === "standard_records") &&
      (point.json?.data?.geometryStatus === "not_standardized" ||
        point.json?.data?.geometryStatus === "standardized") &&
      Boolean(point.json?.meta?.requestId),
    point.text.slice(0, 200),
  );
  if (expectStandardRecords) {
    requireCondition(
      checks,
      "v1 point standard_records payload",
      point.json?.meta?.mode === "standard_records_point" &&
        pointEvaluation?.status === "evaluated" &&
        pointEvaluation?.evaluated === true &&
        point.json?.data?.dataAvailability === "standard_records" &&
        point.json?.data?.geometryStatus === "standardized" &&
        point.json?.data?.records?.length >= 1 &&
        Boolean(firstCoordinateFromGeometry(point.json?.data?.records?.[0]?.geometry)),
      point.text.slice(0, 300),
    );
  }

  const pointBlankLat = await fetchJson(`${baseUrl}/api/v1/records/point?lat=%20&lng=139`);
  requireStatus(checks, "api:/api/v1/records/point invalid blank lat", pointBlankLat.response.status, 400);
  requireCondition(
    checks,
    "v1 point invalid blank lat payload",
    pointBlankLat.json?.error?.code === "invalid_query",
    pointBlankLat.text.slice(0, 200),
  );

  const pointInvalidRadius = await fetchJson(`${baseUrl}/api/v1/records/point?lat=35&lng=139&radiusM=-1`);
  requireStatus(checks, "api:/api/v1/records/point invalid radius", pointInvalidRadius.response.status, 400);
  requireCondition(
    checks,
    "v1 point invalid radius payload",
    pointInvalidRadius.json?.error?.code === "invalid_query",
    pointInvalidRadius.text.slice(0, 200),
  );

  const tooManyCategories = Array.from({ length: 21 }, (_, index) => `cat${index}`).join(",");
  const pointTooManyCategories = await fetchJson(
    `${baseUrl}/api/v1/records/point?lat=35&lng=139&categories=${tooManyCategories}`,
  );
  requireStatus(
    checks,
    "api:/api/v1/records/point too many categories",
    pointTooManyCategories.response.status,
    400,
  );
  requireCondition(
    checks,
    "v1 point too many categories payload",
    pointTooManyCategories.json?.error?.code === "invalid_query",
    pointTooManyCategories.text.slice(0, 200),
  );

  const logsGuard = await fetchJson(`${baseUrl}/api/fetch-logs`);
  requireStatus(checks, "admin guard:/api/fetch-logs", logsGuard.response.status, 401);

  const tagGuard = await fetchJson(`${baseUrl}/api/tags`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `release-smoke-${Date.now()}` }),
  });
  requireStatus(checks, "admin guard:POST /api/tags", tagGuard.response.status, 401);

  const sessionMissingOrigin = await fetchJson(`${baseUrl}/api/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "invalid" }),
  });
  requireStatus(
    checks,
    "admin session csrf:missing origin",
    sessionMissingOrigin.response.status,
    403,
  );
  requireCondition(
    checks,
    "admin session csrf payload",
    sessionMissingOrigin.json?.error === "csrf_check_failed",
    sessionMissingOrigin.text.slice(0, 200),
  );

  const adminToken = process.env.CODIP_ADMIN_TOKEN?.trim();
  if (readOnly) {
    requireCondition(
      checks,
      "admin negative tests skipped in read-only mode",
      true,
      "Use release:smoke without --read-only only against disposable CI/preview databases.",
    );
  } else {
    requireCondition(
      checks,
      "admin negative tests token configured",
      Boolean(adminToken),
      adminToken ? "CODIP_ADMIN_TOKEN configured" : "CODIP_ADMIN_TOKEN is required for release smoke security tests",
    );
  }
  if (adminToken && !readOnly) {
    const maliciousUrls = [
      "javascript:alert(1)",
      "http://127.0.0.1/internal",
      "http://169.254.169.254/latest/meta-data",
      "https://user:pass@example.com/data",
      "https://example.com/data?token=secret",
      "https://example.com/data?api_key=secret",
    ];
    for (const [index, officialUrl] of maliciousUrls.entries()) {
      const maliciousSource = await fetchJson(`${baseUrl}/api/sources`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codip-admin-token": adminToken,
        },
        body: JSON.stringify({
          name: `release-smoke-malicious-url-${Date.now()}-${index}`,
          providerName: "Release Smoke",
          officialUrl,
          category: "gis",
          dataFormat: "JSON",
          accessType: "API",
        }),
      });
      requireStatus(
        checks,
        `admin negative:malicious source url ${index + 1}`,
        maliciousSource.response.status,
        400,
      );
      requireCondition(
        checks,
        `admin negative:malicious source url payload ${index + 1}`,
        maliciousSource.json?.error === "validation_error",
        maliciousSource.text.slice(0, 200),
      );
    }
  }

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    const mark = check.ok ? "OK" : "FAIL";
    console.log(`[release-smoke][${mark}] ${check.name} ${check.detail}`);
  }

  if (failed.length > 0) {
    console.error(`[release-smoke] ${failed.length} check(s) failed`);
    process.exit(1);
  }

  console.log(`[release-smoke] OK ${checks.length} checks against ${baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
