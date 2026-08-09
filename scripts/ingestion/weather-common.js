#!/usr/bin/env node
"use strict";

/**
 * 気象・海象取り込み共通ヘルパー (統合: wmcdss)。
 * - 接続先は固定定数のホストのみ許可 (allowlist)
 * - タイムアウト付き fetch
 * - 監査ログは成功・失敗を常に記録
 */

const ALLOWED_HOSTS = new Set(["www.jma.go.jp", "marine-api.open-meteo.com"]);
const FETCH_TIMEOUT_MS = 15000;

function assertHost(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Blocked outbound URL ${parsed.hostname}`);
  }
}

async function fetchJson(url) {
  assertHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CivilOpenDataIntelligencePlatform/0.1 (weather-ingestion)" },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`upstream returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function writeAudit(prisma, { actor, action, target, detail }) {
  return prisma.auditLog.create({
    data: {
      actor,
      action,
      target,
      detail: JSON.stringify(detail),
      level: detail.upstream_5xx > 0 || detail.upsert_failed > 0 ? "warning" : "info",
    },
  });
}

module.exports = { fetchJson, toNumber, writeAudit };
