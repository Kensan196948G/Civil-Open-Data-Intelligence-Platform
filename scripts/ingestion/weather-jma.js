#!/usr/bin/env node
"use strict";

/**
 * AMeDAS 気象データ取り込み (統合: wmcdss backend/app/jobs/ingest_jma.py)。
 * 10分毎に各現場の jma_station_id の最新観測を取得し、
 * (siteId, observedAt, dataVersion) で upsert する。
 */

const { fetchJson, toNumber, writeAudit } = require("./weather-common.js");

const JMA_BASE = "https://www.jma.go.jp/bosai/amedas/data/point";
const WIND_DIR_DEG = {
  0: null, 1: 22.5, 2: 45, 3: 67.5, 4: 90, 5: 112.5, 6: 135, 7: 157.5,
  8: 180, 9: 202.5, 10: 225, 11: 247.5, 12: 270, 13: 292.5, 14: 315, 15: 337.5, 16: 0,
};

function jstNow() {
  return new Date(new Date().getTime() + 9 * 3600 * 1000);
}

function blockUrl(stationId, ts) {
  const h = Math.floor(ts.getUTCHours() / 3) * 3;
  const ymd = `${ts.getUTCFullYear()}${String(ts.getUTCMonth() + 1).padStart(2, "0")}${String(ts.getUTCDate()).padStart(2, "0")}`;
  return `${JMA_BASE}/${stationId}/${ymd}_${String(h).padStart(2, "0")}.json`;
}

function valueWithQc(entry, key) {
  const v = entry[key];
  if (!Array.isArray(v) || v.length < 2 || v[1] !== 0) return null;
  return toNumber(v[0]);
}

function latestEntry(payload) {
  if (!payload || typeof payload !== "object") return null;
  const keys = Object.keys(payload).sort();
  if (keys.length === 0) return null;
  const latestKey = keys[keys.length - 1];
  const entry = payload[latestKey];
  if (!entry || typeof entry !== "object") return null;
  const fmt = latestKey.length === 14 ? "YYYYMMDDHHMMSS" : "YYYYMMDDHHMM";
  const observedJst = parseJst(latestKey, fmt);
  return observedJst ? { observedAt: observedJst, entry } : null;
}

function parseJst(value, fmt) {
  const parts = fmt === "YYYYMMDDHHMMSS"
    ? [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12), value.slice(12, 14)]
    : [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8), value.slice(8, 10), value.slice(10, 12)];
  const [y, mo, d, h, mi, s = 0] = parts.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s) - 9 * 3600 * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchLatest(prisma, site) {
  const nowJst = jstNow();
  for (const offsetHours of [0, -3]) {
    const ts = new Date(nowJst.getTime() + offsetHours * 3600 * 1000);
    const url = blockUrl(site.jmaStationId, ts);
    const payload = await fetchJson(url);
    if (payload) {
      const found = latestEntry(payload);
      if (found) return { ...found, url };
    }
  }
  return null;
}

function normalise(entry, observedAt, siteId, stationId) {
  const sunSec = valueWithQc(entry, "sun10m");
  const windDirIndex = valueWithQc(entry, "windDirection");
  return {
    siteId,
    observedAt,
    temperatureC: valueWithQc(entry, "temp"),
    humidityPct: valueWithQc(entry, "humidity"),
    pressureHpa: valueWithQc(entry, "pressure"),
    precipMm: valueWithQc(entry, "precipitation10m"),
    windSpeedMs: valueWithQc(entry, "wind"),
    windGustMs: valueWithQc(entry, "windGust"),
    windDirDeg: windDirIndex !== null ? (WIND_DIR_DEG[windDirIndex] ?? null) : null,
    sunshineH: sunSec !== null ? sunSec / 3600 : null,
    dataVersion: 1,
    source: "jma",
  };
}

async function runOnce(prisma) {
  const sites = await prisma.constructionSite.findMany({
    where: { jmaStationId: { not: null } },
  });
  let written = 0;
  let fetchFailed = 0;
  let upsertFailed = 0;
  let noData = 0;
  let upstream4xx = 0;
  let upstream5xx = 0;

  for (const site of sites) {
    try {
      const result = await fetchLatest(prisma, site);
      if (!result) {
        noData += 1;
        continue;
      }
      const data = normalise(result.entry, result.observedAt, site.id, site.jmaStationId);
      await prisma.weatherObservation.upsert({
        where: { siteId_observedAt_dataVersion: { siteId: site.id, observedAt: data.observedAt, dataVersion: 1 } },
        create: data,
        update: data,
      });
      written += 1;
    } catch (error) {
      const message = String(error?.message || error);
      if (/HTTP 4\d\d/.test(message)) upstream4xx += 1;
      if (/HTTP 5\d\d/.test(message)) upstream5xx += 1;
      if (message.includes("HTTP")) {
        fetchFailed += 1;
      } else {
        upsertFailed += 1;
      }
    }
  }

  const detail = {
    written,
    fetch_failed: fetchFailed,
    upsert_failed: upsertFailed,
    no_data: noData,
    upstream_4xx: upstream4xx,
    upstream_5xx: upstream5xx,
    sites_total: sites.length,
    source: "jma_amedas",
  };
  await writeAudit(prisma, {
    actor: "jma_fetcher",
    action: "気象観測取り込み",
    target: "weather_observations",
    detail,
  });
  console.log(`[weather-jma] wrote=${written} failed=${fetchFailed} no_data=${noData} sites=${sites.length}`);
  return { ...detail };
}

module.exports = { runOnce, normalise, latestEntry };
