#!/usr/bin/env node
"use strict";

const { stripTagSpans } = require("./html-text");

/**
 * CKAN オープンデータカタログのハーベスト（BODIK / JIG 等）。
 *
 * package_search でデータセット一覧を取得し、JSON/CSV/GeoJSON/XML のリソースを
 * 台帳（data_sources）へ upsert する。書き込み対象は preview / production の
 * PostgreSQL（DATABASE_URL）で、実行は人間が dispatch する（本番への実行は承認事項）。
 *
 * 使い方:
 *   DATABASE_URL=postgres://... node scripts/ingestion/harvest-ckan.js \
 *     --catalog-url https://data.bodik.jp --rows 20 [--dry-run]
 */

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("../../node_modules/.prisma/client-postgresql");

const ALLOWED_CATALOG_HOSTS = new Set(["data.bodik.jp", "ckan.odp.jig.jp"]);
const SUPPORTED_FORMATS = new Set(["json", "csv", "geojson", "xml"]);
const FETCH_TIMEOUT_MS = 20000;

function normalizeFormat(format) {
  const value = String(format || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (value === "json") return "JSON";
  if (value === "csv") return "CSV";
  if (value === "geojson") return "GeoJSON";
  if (value === "xml") return "XML";
  return value ? value.toUpperCase() : "other";
}

/** リソースから JSON/CSV/GeoJSON/XML の https URL を優先して選ぶ。 */
function selectPreferredResource(resources) {
  const list = Array.isArray(resources) ? resources : [];
  const byFormat = (format) => list.find((r) => normalizeFormat(r.format) === format);
  const preferred =
    byFormat("JSON") ?? byFormat("GeoJSON") ?? byFormat("CSV") ?? byFormat("XML") ?? list[0];
  if (!preferred) return null;
  const url = String(preferred.url || "").trim();
  if (!/^https:\/\//.test(url)) return null;
  return { url, format: normalizeFormat(preferred.format) };
}

/** package_search の1件から台帳エントリへ変換する（純関数・テスト対象）。 */
function buildSourceFromPackage(pkg, catalogUrl, providerName, now = new Date()) {
  const resource = selectPreferredResource(pkg.resources);
  const datasetUrl = `${catalogUrl}/dataset/${encodeURIComponent(pkg.name || pkg.id || "")}`;
  const officialUrl = resource ? resource.url : datasetUrl;
  if (!/^https:\/\//.test(officialUrl)) return null;
  return {
    providerName,
    name: String(pkg.title || pkg.name || pkg.id || "CKAN dataset").slice(0, 200),
    nameEn: String(pkg.name || "").slice(0, 200) || undefined,
    description: stripTagSpans(pkg.notes || pkg.title || "オープンデータカタログのデータセット").slice(
      0,
      500,
    ),
    officialUrl,
    endpointUrl: resource ? resource.url : undefined,
    documentationUrl: datasetUrl,
    category: "gis",
    dataFormat: resource ? resource.format : "other",
    accessType: resource ? "API" : "web",
    requiresApiKey: false,
    licenseName: String(pkg.license_title || "利用条件はカタログ側を確認").slice(0, 200),
    commercialUse: "restricted",
    attributionRequired: true,
    updateFrequency: "irregular",
    trustLevel: 3,
    qualityScore: 60,
    note: `CKAN harvest from ${catalogUrl} at ${now.toISOString()}`,
    tags: ["自治体", "利用条件要確認"],
    useCases: [{ useCaseName: "自治体オープンデータの発見", targetSystem: "Open Data Discovery" }],
  };
}

async function fetchCatalog(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_CATALOG_HOSTS.has(parsed.hostname)) {
    throw new Error(`Blocked CKAN catalog host: ${parsed.hostname}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CivilOpenDataIntelligencePlatform/0.1 (ckan-harvest)" },
    });
    if (!response.ok) throw new Error(`CKAN returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv) {
  const options = { rows: 20, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === "--catalog-url") options.catalogUrl = next();
    else if (arg === "--rows") options.rows = Math.max(1, Math.min(200, Number(next()) || 20));
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.catalogUrl) {
    console.log(
      "Usage: node scripts/ingestion/harvest-ckan.js --catalog-url https://data.bodik.jp --rows 20 [--dry-run]",
    );
    process.exit(options.help ? 0 : 1);
  }
  const connectionString = (process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("missing DATABASE_URL");

  const parsedCatalog = new URL(options.catalogUrl);
  const providerName = parsedCatalog.hostname === "data.bodik.jp" ? "BODIK(オープンデータ推進)" : "JIG";
  const searchUrl = `${options.catalogUrl.replace(/\/+$/, "")}/api/3/action/package_search?rows=${options.rows}`;

  const payload = await fetchCatalog(searchUrl);
  const packages = payload?.result?.results || [];
  const now = new Date();
  const candidates = packages
    .map((pkg) => buildSourceFromPackage(pkg, options.catalogUrl.replace(/\/+$/, ""), providerName, now))
    .filter(Boolean);

  console.log(`[harvest-ckan] catalog=${options.catalogUrl} rows=${options.rows} candidates=${candidates.length}`);
  if (options.dryRun) {
    for (const c of candidates.slice(0, 10)) {
      console.log(`- ${c.name} [${c.dataFormat}] ${c.officialUrl}`);
    }
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    let created = 0;
    let updated = 0;
    for (const candidate of candidates) {
      const existing = await prisma.dataSource.findUnique({
        where: { officialUrl: candidate.officialUrl },
      });
      if (existing) {
        await prisma.dataSource.update({
          where: { id: existing.id },
          data: { ...candidate, provider: undefined },
        });
        updated += 1;
      } else {
        await prisma.dataSource.create({
          data: { ...candidate, provider: { connect: { name: candidate.providerName } } },
        });
        created += 1;
      }
    }
    console.log(`[harvest-ckan] created=${created} updated=${updated}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[harvest-ckan][error] ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = { buildSourceFromPackage, selectPreferredResource, normalizeFormat };
