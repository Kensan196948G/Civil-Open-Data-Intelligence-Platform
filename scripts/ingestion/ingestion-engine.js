#!/usr/bin/env node
"use strict";

const net = require("node:net");
const dns = require("node:dns/promises");
const crypto = require("node:crypto");
const { Agent, fetch: undiciFetch } = require("undici");

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;
const REDIRECT_LIMIT = 3;

const BLOCKED_HOSTNAMES = ["localhost", "localhost.localdomain"];
const BLOCKED_SUFFIXES = [".local", ".internal", ".localdomain", ".lan", ".corp", ".home"];

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) {
    const normalized = ip.replace(/%.*$/, "").toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80:")) return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    return false;
  }
  return true;
}

function assertIngestionUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "URL形式が正しくありません" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "http/https 以外のスキームは許可されていません" };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { ok: false, reason: "localhost への取得は禁止されています" };
  }
  if (BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, reason: "内部ドメインへの取得は禁止されています" };
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { ok: false, reason: "private IP への取得は禁止されています" };
  }
  return { ok: true, url };
}

async function assertIngestionUrlResolved(urlStr) {
  const staticResult = assertIngestionUrl(urlStr);
  if (!staticResult.ok) return staticResult;
  const { url } = staticResult;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return staticResult;
  try {
    const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
    const addresses = [
      ...(v4.status === "fulfilled" ? v4.value : []),
      ...(v6.status === "fulfilled" ? v6.value : []),
    ];
    if (addresses.length === 0) return { ok: false, reason: "ホスト名を解決できませんでした" };
    if (addresses.some((address) => isPrivateIp(address))) {
      return { ok: false, reason: "内部ネットワークへ解決されるホストは禁止されています" };
    }
  } catch {
    return { ok: false, reason: "ホスト名を解決できませんでした" };
  }
  return staticResult;
}

let pinnedAgent = null;
function getPinnedAgent() {
  if (!pinnedAgent) {
    pinnedAgent = new Agent({
      connect: {
        lookup(hostname, options, callback) {
          dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) {
              callback(err);
              return;
            }
            const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
            if (list.length === 0) {
              callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }));
              return;
            }
            const blocked = list.find((item) => isPrivateIp(item.address));
            if (blocked) {
              callback(
                Object.assign(new Error("接続先が非公開アドレスに解決されたため拒否しました"), {
                  code: "EPRIVATEADDR",
                }),
              );
              return;
            }
            if (options?.all) {
              callback(null, list);
            } else {
              callback(null, list[0].address, list[0].family);
            }
          });
        },
      },
    });
  }
  return pinnedAgent;
}

async function fetchIngestionPayload(urlStr, options = {}) {
  const {
    etag = null,
    lastModified = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    fetchImpl = undiciFetch,
  } = options;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const guard = await assertIngestionUrlResolved(urlStr);
    if (!guard.ok) {
      return { ok: false, errorType: "blocked_url", errorMessage: guard.reason, responseTimeMs: Date.now() - startedAt };
    }

    let currentUrl = guard.url.toString();
    let response = null;
    for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
      const hopGuard = assertIngestionUrl(currentUrl);
      if (!hopGuard.ok) {
        return { ok: false, errorType: "blocked_url", errorMessage: hopGuard.reason, responseTimeMs: Date.now() - startedAt };
      }
      response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        dispatcher: getPinnedAgent(),
        headers: {
          "User-Agent": "CivilOpenDataIntelligencePlatform/0.2 (ingestion)",
          Accept: "application/geo+json, application/json, text/csv, application/octet-stream, */*",
          ...(etag ? { "If-None-Match": etag } : {}),
          ...(lastModified ? { "If-Modified-Since": lastModified } : {}),
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        if (hop === REDIRECT_LIMIT) {
          return {
            ok: false,
            statusCode: response.status,
            errorType: "network",
            errorMessage: `リダイレクト回数が上限(${REDIRECT_LIMIT}回)を超えました`,
            responseTimeMs: Date.now() - startedAt,
          };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }

    if (!response) {
      return { ok: false, errorType: "unknown", errorMessage: "レスポンスを取得できませんでした", responseTimeMs: Date.now() - startedAt };
    }

    const responseTimeMs = Date.now() - startedAt;
    const statusCode = response.status;
    const contentType = response.headers.get("content-type") ?? null;
    const newEtag = response.headers.get("etag");
    const newLastModified = response.headers.get("last-modified");

    if (statusCode === 304) {
      return {
        ok: true,
        notModified: true,
        statusCode,
        contentType,
        etag: newEtag,
        lastModified: newLastModified,
        responseTimeMs,
        bytesReceived: 0,
        bodyText: "",
      };
    }
    if (statusCode === 401 || statusCode === 403) {
      return { ok: false, statusCode, errorType: "auth_required", errorMessage: `HTTP ${statusCode}: APIキーまたは認証が必要です`, responseTimeMs };
    }
    if (statusCode === 429) {
      return { ok: false, statusCode, errorType: "rate_limited", errorMessage: "HTTP 429: アクセス制限の可能性があります", responseTimeMs };
    }
    if (statusCode < 200 || statusCode >= 300) {
      return { ok: false, statusCode, errorType: "http_error", errorMessage: `HTTP ${statusCode}`, responseTimeMs };
    }

    if (!response.body) {
      return { ok: false, statusCode, errorType: "network", errorMessage: "レスポンスボディがありません", responseTimeMs };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let bytesRead = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => {});
        return {
          ok: false,
          statusCode,
          errorType: "payload_too_large",
          errorMessage: `取得サイズが上限(${maxBytes} bytes)を超えました`,
          responseTimeMs,
          bytesReceived: bytesRead,
        };
      }
      chunks.push(value);
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    return {
      ok: true,
      statusCode,
      contentType,
      etag: newEtag,
      lastModified: newLastModified,
      responseTimeMs,
      bytesReceived: bytesRead,
      bodyText,
    };
  } catch (error) {
    return {
      ok: false,
      errorType: error?.name === "AbortError" ? "timeout" : error?.code || "network",
      errorMessage: error?.message || "取得に失敗しました",
      responseTimeMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const lines = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) lines.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) lines.push(row);
  if (lines.length === 0) return [];
  const header = lines[0].map((cell) => cell.trim());
  return lines.slice(1).map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      if (key) record[key] = cells[index] ?? "";
    });
    return record;
  });
}

function parseJsonPayload(bodyText) {
  const parsed = JSON.parse(bodyText);
  if (Array.isArray(parsed)) return { kind: "rows", rows: parsed };
  if (parsed && Array.isArray(parsed.features)) {
    return { kind: "geojson", rows: parsed.features };
  }
  if (parsed && Array.isArray(parsed.items)) return { kind: "rows", rows: parsed.items };
  if (parsed && typeof parsed === "object") return { kind: "rows", rows: [parsed] };
  throw new Error("JSON はオブジェクト/配列ではありません");
}

function normalizeDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 10_000_000_000) {
    return new Date(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text
    .replace(/[年月日]/g, "-")
    .replace(/[時分秒]/g, ":")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/:+/g, ":");
  const trimmed = normalized.replace(/[-: ]+$/g, "");
  const match = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[,\s円%]/g, "").replace(/[−―]/g, "-");
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function normalizeCoordinate(value, axis) {
  const num = normalizeNumber(value);
  if (num == null) return null;
  if (axis === "lat" && num >= -90 && num <= 90) return num;
  if (axis === "lng" && num >= -180 && num <= 180) return num;
  // Web Mercator (EPSG:3857) を簡易変換して判定
  const max = 20_037_508.34;
  if (Math.abs(num) <= max) {
    if (axis === "lng") {
      const lng = (num / max) * 180;
      return lng >= -180 && lng <= 180 ? lng : null;
    }
    const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((num / max) * Math.PI)) - Math.PI / 2);
    return lat >= -90 && lat <= 90 ? lat : null;
  }
  return null;
}

function dedupeKey(input) {
  const parts = [
    input.category ?? "",
    input.title ?? "",
    input.address ?? "",
    input.lng != null ? String(Math.round(input.lng * 1e5)) : "",
    input.lat != null ? String(Math.round(input.lat * 1e5)) : "",
    input.observedAt instanceof Date ? input.observedAt.toISOString() : "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function pickCoordinates(row, geometry) {
  let lng = normalizeCoordinate(row.lng ?? row.lon ?? row.longitude ?? row.LONGITUDE, "lng");
  let lat = normalizeCoordinate(row.lat ?? row.Latitude ?? row.LATITUDE, "lat");
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    lng = normalizeCoordinate(geometry.coordinates[0], "lng");
    lat = normalizeCoordinate(geometry.coordinates[1], "lat");
  }
  if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates?.[0])) {
    lng = normalizeCoordinate(geometry.coordinates[0][0], "lng");
    lat = normalizeCoordinate(geometry.coordinates[0][1], "lat");
  }
  return { lng, lat };
}

function candidateFromCsvRow(row, source) {
  const geometry = null;
  const { lng, lat } = pickCoordinates(row, geometry);
  const title = String(row.title ?? row.name ?? row.名称 ?? row.地点名 ?? "").trim();
  const category = String(row.category ?? row.分類 ?? source.category ?? "other").trim();
  const address = String(row.address ?? row.住所 ?? row.所在地 ?? "").trim() || null;
  return {
    sourceRecordId: dedupeKey({ category, title, address, lng, lat, observedAt: normalizeDate(row.observedAt ?? row.日付 ?? row.更新日) }),
    category,
    title: title || "無題",
    description: row.description ?? row.説明 ?? null,
    address,
    lng,
    lat,
    observedAt: normalizeDate(row.observedAt ?? row.日付 ?? row.更新日),
    publishedAt: normalizeDate(row.publishedAt ?? row.公開日),
    properties: { raw: row, provider: source.providerName ?? null },
  };
}

function candidateFromFeature(feature, source, index) {
  const props = feature.properties ?? {};
  const { lng, lat } = pickCoordinates(props, feature.geometry);
  const title = String(props.title ?? props.name ?? props.名称 ?? `${source.name} #${index + 1}`).trim();
  const category = String(props.category ?? props.分類 ?? source.category ?? "other").trim();
  const address = String(props.address ?? props.住所 ?? props.所在地 ?? "").trim() || null;
  return {
    sourceRecordId: dedupeKey({ category, title, address, lng, lat, observedAt: normalizeDate(props.observedAt ?? props.日付) }),
    category,
    title: title || "無題",
    description: props.description ?? props.説明 ?? null,
    address,
    lng,
    lat,
    observedAt: normalizeDate(props.observedAt ?? props.日付 ?? props.更新日),
    publishedAt: normalizeDate(props.publishedAt ?? props.公開日),
    properties: { raw: props, provider: source.providerName ?? null },
    geometry: feature.geometry,
  };
}

function parsePayload(bodyText, contentType, source) {
  const ct = (contentType ?? "").toLowerCase();
  const trimmed = bodyText.trimStart();
  let kind = "rows";
  let rows = [];
  if (ct.includes("csv") || /^[^"{[\s][^\n]*,[^\n]*/.test(trimmed)) {
    rows = parseCsv(bodyText);
  } else if (ct.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = parseJsonPayload(bodyText);
    kind = parsed.kind;
    rows = parsed.rows;
  } else {
    throw new Error("CSV / JSON / GeoJSON 以外の形式は現行パイプラインで非対応です");
  }
  return rows.map((row, index) =>
    kind === "geojson" ? candidateFromFeature(row, source, index) : candidateFromCsvRow(row, source),
  );
}

async function upsertStandardRecords(prisma, { dataSourceId, ingestionRunId, candidates, maxRecords }) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const limited = candidates.slice(0, maxRecords);
  for (const candidate of limited) {
    if (!candidate.title || (!candidate.lng && !candidate.lat && !candidate.address && !candidate.geometry)) {
      skipped += 1;
      continue;
    }
    const data = {
      dataSourceId,
      sourceRecordId: candidate.sourceRecordId,
      category: candidate.category,
      title: candidate.title,
      description: candidate.description,
      prefectureCode: candidate.prefectureCode ?? null,
      municipalityCode: candidate.municipalityCode ?? null,
      address: candidate.address,
      observedAt: candidate.observedAt,
      publishedAt: candidate.publishedAt,
      retrievedAt: new Date(),
      validFrom: candidate.validFrom ?? null,
      validTo: candidate.validTo ?? null,
      sourceUrl: candidate.sourceUrl ?? null,
      licenseId: candidate.licenseId ?? null,
      qualityStatus: candidate.qualityStatus ?? "needs_review",
      rawDataReference: candidate.rawDataReference ?? null,
      ingestionRunId,
      properties: candidate.properties ?? {},
    };
    const existing = await prisma.standardRecord.findFirst({
      where: { dataSourceId, sourceRecordId: candidate.sourceRecordId },
    });
    if (existing) {
      await prisma.standardRecord.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.standardRecord.create({ data });
      inserted += 1;
    }
  }
  return { inserted, updated, skipped };
}

function nextRunDelayMinutes(status, retryCount) {
  if (status === "success") return 0;
  return Math.min(60 * 12, 15 * 2 ** Math.min(retryCount, 5));
}

async function runIngestionJob(prisma, options = {}) {
  const { jobId, triggeredBy = "manual", now = new Date(), fetchImpl, maxBytes, timeoutMs } = options;
  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    include: { dataSource: true },
  });
  if (!job) throw new Error(`ingestion job not found: ${jobId}`);
  const targetUrl = job.dataSource.endpointUrl || job.dataSource.officialUrl;
  if (!targetUrl) {
    throw new Error(`data source ${job.dataSource.id} has no endpointUrl/officialUrl`);
  }

  const run = await prisma.ingestionRun.create({
    data: {
      ingestionJobId: jobId,
      status: "running",
      triggeredBy,
      requestUrl: targetUrl,
    },
  });

  const fetchResult = await fetchIngestionPayload(targetUrl, {
    etag: job.etag,
    lastModified: job.lastModified,
    fetchImpl,
    maxBytes,
    timeoutMs,
  });

  const baseRunUpdate = {
    statusCode: fetchResult.statusCode ?? null,
    responseTimeMs: fetchResult.responseTimeMs ?? null,
    bytesReceived: fetchResult.bytesReceived ?? null,
  };

  if (fetchResult.notModified) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { ...baseRunUpdate, status: "skipped", note: "304 Not Modified (変更なし)", finishedAt: now },
    });
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + job.intervalMinutes * 60_000), lastStatus: "skipped", retryCount: 0 },
    });
    return { status: "skipped", inserted: 0, updated: 0, skipped: 0 };
  }

  if (!fetchResult.ok) {
    const retryCount = job.retryCount + 1;
    const status = retryCount >= job.maxRetries ? "failed" : "retrying";
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        ...baseRunUpdate,
        status: "failed",
        errorType: fetchResult.errorType ?? "unknown",
        errorMessage: fetchResult.errorMessage ?? null,
        note: retryCount < job.maxRetries ? `再試行 ${retryCount}/${job.maxRetries}` : `リトライ上限到達 ${job.maxRetries}`,
        finishedAt: now,
      },
    });
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + nextRunDelayMinutes(status, retryCount) * 60_000),
        lastStatus: status,
        retryCount,
      },
    });
    return { status, inserted: 0, updated: 0, skipped: 0 };
  }

  let candidates;
  try {
    candidates = parsePayload(fetchResult.bodyText, fetchResult.contentType, job.dataSource);
  } catch (error) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { ...baseRunUpdate, status: "failed", errorType: "parse_error", errorMessage: error?.message ?? "parse error", finishedAt: now },
    });
    await prisma.ingestionJob.update({
      where: { id: jobId },
      data: {
        lastRunAt: now,
        nextRunAt: new Date(now.getTime() + nextRunDelayMinutes("failed", job.retryCount + 1) * 60_000),
        lastStatus: "failed",
        retryCount: job.retryCount + 1,
      },
    });
    return { status: "failed", inserted: 0, updated: 0, skipped: 0 };
  }

  const counts = await upsertStandardRecords(prisma, {
    dataSourceId: job.dataSource.id,
    ingestionRunId: run.id,
    candidates,
    maxRecords: job.maxRecords || DEFAULT_MAX_RECORDS,
  });
  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      ...baseRunUpdate,
      status: "success",
      recordsInserted: counts.inserted,
      recordsUpdated: counts.updated,
      recordsSkipped: counts.skipped,
      note: `${candidates.length}件中 ${counts.inserted}挿入 / ${counts.updated}更新 / ${counts.skipped}スキップ`,
      finishedAt: now,
    },
  });
  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: {
      etag: fetchResult.etag ?? null,
      lastModified: fetchResult.lastModified ?? null,
      lastRunAt: now,
      nextRunAt: new Date(now.getTime() + job.intervalMinutes * 60_000),
      lastStatus: "success",
      retryCount: 0,
    },
  });
  return { status: "success", ...counts };
}

async function runDueIngestionJobs(prisma, options = {}) {
  const { maxJobs = 3, now = new Date(), triggeredBy = "schedule", fetchImpl } = options;
  const jobs = await prisma.ingestionJob.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }],
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: maxJobs,
    include: { dataSource: true },
  });
  const results = [];
  for (const job of jobs) {
    const result = await runIngestionJob(prisma, {
      jobId: job.id,
      triggeredBy,
      now,
      fetchImpl,
    });
    results.push({ jobId: job.id, dataSourceId: job.dataSource.id, ...result });
  }
  return { jobs: results, count: results.length };
}

async function stopIngestionRun(prisma, { runId, note = "stopped by operator" }) {
  const run = await prisma.ingestionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`ingestion run not found: ${runId}`);
  if (run.status !== "running" && run.status !== "pending") {
    return { status: run.status, changed: false };
  }
  await prisma.ingestionRun.update({
    where: { id: runId },
    data: { status: "stopped", finishedAt: new Date(), note },
  });
  return { status: "stopped", changed: true };
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_RECORDS,
  DEFAULT_TIMEOUT_MS,
  assertIngestionUrl,
  fetchIngestionPayload,
  parseCsv,
  parsePayload,
  normalizeDate,
  normalizeNumber,
  normalizeCoordinate,
  dedupeKey,
  runIngestionJob,
  runDueIngestionJobs,
  stopIngestionRun,
  upsertStandardRecords,
};
