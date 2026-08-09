#!/usr/bin/env node
"use strict";

/**
 * Open-Meteo Marine 参考情報取り込み (統合: wmcdss backend/app/jobs/ingest_jma_marine.py)。
 * 参考情報のみ (source=open_meteo_marine_info)。施工判定の入力には使用しない。
 */

const { fetchJson, toNumber, writeAudit } = require("./weather-common.js");

const API_URL = "https://marine-api.open-meteo.com/v1/marine";
const CURRENT_VARS = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "sea_level_height_msl",
  "ocean_current_velocity",
  "ocean_current_direction",
].join(",");
const SOURCE = "open_meteo_marine_info";

async function fetchLatest(lat, lon) {
  const url = `${API_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=${CURRENT_VARS}&timezone=UTC&cell_selection=sea`;
  const payload = await fetchJson(url);
  const current = payload?.current;
  if (!current || typeof current !== "object" || !current.time) return null;
  const observedAt = new Date(current.time);
  if (Number.isNaN(observedAt.getTime())) return null;
  return { observedAt, entry: current };
}

function normalise(entry, observedAt, siteId) {
  const currentKmh = toNumber(entry.ocean_current_velocity);
  return {
    siteId,
    observedAt,
    sigWaveHM: toNumber(entry.wave_height),
    wavePeriodS: toNumber(entry.wave_period),
    waveDirDeg: toNumber(entry.wave_direction),
    tideLevelM: toNumber(entry.sea_level_height_msl),
    currentSpeedMs: currentKmh !== null ? currentKmh / 3.6 : null,
    currentDirDeg: toNumber(entry.ocean_current_direction),
    dataVersion: 1,
    source: SOURCE,
  };
}

async function runOnce(prisma) {
  const sites = await prisma.constructionSite.findMany({
    where: { kind: { in: ["marine", "both"] } },
  });
  let written = 0;
  let fetchFailed = 0;
  let upsertFailed = 0;
  let noData = 0;
  let upstream4xx = 0;
  let upstream5xx = 0;

  for (const site of sites) {
    try {
      const result = await fetchLatest(site.lat, site.lon);
      if (!result) {
        noData += 1;
        continue;
      }
      const data = normalise(result.entry, result.observedAt, site.id);
      await prisma.marineObservation.upsert({
        where: { siteId_observedAt_dataVersion: { siteId: site.id, observedAt: data.observedAt, dataVersion: 1 } },
        create: data,
        update: data,
      });
      written += 1;
    } catch (error) {
      const message = String(error?.message || error);
      if (/HTTP 4\d\d/.test(message)) upstream4xx += 1;
      if (/HTTP 5\d\d/.test(message)) upstream5xx += 1;
      if (message.includes("HTTP")) fetchFailed += 1;
      else upsertFailed += 1;
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
    source: SOURCE,
    usage: "information_sharing_only",
  };
  await writeAudit(prisma, {
    actor: "open_meteo_marine_fetcher",
    action: "海象観測取り込み",
    target: "marine_observations",
    detail,
  });
  console.log(`[marine-openmeteo] wrote=${written} failed=${fetchFailed} no_data=${noData} sites=${sites.length}`);
  return { ...detail };
}

module.exports = { runOnce, normalise };
