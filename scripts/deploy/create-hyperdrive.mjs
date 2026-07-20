#!/usr/bin/env node
// Create (or reuse) the production Hyperdrive config for CODIP.
//
// Secrets-safe by design:
// - Neon connection URI is fetched via the Neon API and kept in-process only.
// - Output contains ONLY non-secret values (Hyperdrive ID, config name, port).
// - Never log URIs, passwords, hosts with credentials, or API tokens.
//
// Required env: NEON_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Optional env: CODIP_NEON_PROJECT_ID (default below), CODIP_HYPERDRIVE_NAME
//
// Usage: node scripts/deploy/create-hyperdrive.mjs

const NEON_API = "https://console.neon.tech/api/v2";
const CF_API = "https://api.cloudflare.com/client/v4";

// Stable, non-secret resource identifiers (see docs/runbooks/cloudflare-production.md)
const DEFAULT_NEON_PROJECT_ID = "falling-dawn-93620497"; // Civil-Open-Data-Intelligence-Platform
const DEFAULT_HYPERDRIVE_NAME = "codip-production";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[create-hyperdrive] missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function neonGet(apiKey, path) {
  const res = await fetch(`${NEON_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    // Do not echo response bodies: they may contain connection details.
    throw new Error(`Neon API ${path.split("?")[0]} failed: HTTP ${res.status}`);
  }
  return res.json();
}

async function cfRequest(token, accountId, method, path, body) {
  const res = await fetch(`${CF_API}/accounts/${accountId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!json?.success) {
    const codes = (json?.errors ?? []).map((e) => e.code).join(",") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed: ${codes}`);
  }
  return json.result;
}

async function main() {
  const neonKey = requiredEnv("NEON_API_KEY");
  const cfToken = requiredEnv("CLOUDFLARE_API_TOKEN");
  const accountId = requiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const projectId = process.env.CODIP_NEON_PROJECT_ID?.trim() || DEFAULT_NEON_PROJECT_ID;
  const configName = process.env.CODIP_HYPERDRIVE_NAME?.trim() || DEFAULT_HYPERDRIVE_NAME;

  // Idempotency: reuse an existing config of the same name.
  // The list API paginates (default per_page=20), so walk every page.
  const existing = [];
  for (let page = 1; ; page += 1) {
    const batch = await cfRequest(
      cfToken,
      accountId,
      "GET",
      `/hyperdrive/configs?page=${page}&per_page=100`,
    );
    existing.push(...batch);
    if (batch.length < 100) break;
  }
  const found = existing.find((c) => c.name === configName);
  if (found) {
    console.log(`[create-hyperdrive] reusing existing config "${configName}"`);
    console.log(`HYPERDRIVE_ID=${found.id}`);
    return;
  }

  // Resolve Neon default branch -> database -> direct (non-pooled) connection URI.
  const { branches } = await neonGet(neonKey, `/projects/${projectId}/branches`);
  const branch = branches.find((b) => b.default) ?? branches[0];
  if (!branch) throw new Error("Neon project has no branches");

  const { databases } = await neonGet(
    neonKey,
    `/projects/${projectId}/branches/${branch.id}/databases`,
  );
  const database = databases[0];
  if (!database) throw new Error("Neon default branch has no databases");

  const query = new URLSearchParams({
    branch_id: branch.id,
    database_name: database.name,
    role_name: database.owner_name,
    pooled: "false", // Hyperdrive pools on its own; use the Neon direct endpoint.
  });
  const { uri } = await neonGet(neonKey, `/projects/${projectId}/connection_uri?${query}`);
  const parsed = new URL(uri);

  const created = await cfRequest(cfToken, accountId, "POST", "/hyperdrive/configs", {
    name: configName,
    origin: {
      scheme: "postgres",
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    },
    // Correctness first for the initial release: no query caching.
    // Revisit as an optimization once production behavior is baselined.
    caching: { disabled: true },
  });

  console.log(`[create-hyperdrive] created config "${configName}" (caching disabled)`);
  console.log(`HYPERDRIVE_ID=${created.id}`);
}

main().catch((error) => {
  console.error(`[create-hyperdrive] ${error.message}`);
  process.exit(1);
});
