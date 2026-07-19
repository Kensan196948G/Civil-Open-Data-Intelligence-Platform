#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const dockerignore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const composePg = fs.readFileSync(path.join(root, "docker-compose.postgresql-preview.yml"), "utf8");

const errors = [];

function requireText(label, source, needle) {
  if (!source.includes(needle)) {
    errors.push(`${label} missing ${needle}`);
  }
}

requireText("Dockerfile", dockerfile, "FROM node:22-bookworm-slim@sha256:");
requireText("Dockerfile", dockerfile, "FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS prod-deps");
requireText("Dockerfile", dockerfile, "FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS runtime-base");
requireText("Dockerfile", dockerfile, "RUN npm ci --omit=dev");
requireText("Dockerfile", dockerfile, "FROM runtime-base AS runner");
requireText("Dockerfile", dockerfile, "COPY --from=builder --chown=node:node /app/node_modules ./node_modules");
requireText("Dockerfile", dockerfile, "RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx");
requireText("Dockerfile", dockerfile, "USER node");
requireText("Dockerfile", dockerfile, "node scripts/tools/validate-env.js --mode ${CODIP_ENV_MODE:-production}");
requireText("Dockerfile", dockerfile, "node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port ${PORT}");
if (dockerfile.includes("chown -R node:node /data /app") || dockerfile.includes("chown -R node:node /app")) {
  errors.push("Dockerfile must not make /app writable by the runtime node user");
}

requireText(".dockerignore", dockerignore, ".env*");
requireText(".dockerignore", dockerignore, "!.env.example");

requireText("CI workflow", ci, "docker-supply-chain:");
requireText("CI workflow", ci, "docker-image-security:");
requireText("CI workflow", ci, "needs: [verify, e2e, postgresql-compat, docker-preview, docker-image-security]");
requireText("CI workflow", ci, "packages: write");
requireText("CI workflow", ci, "attestations: write");
requireText("CI workflow", ci, "id-token: write");
requireText("CI workflow", ci, "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
requireText("CI workflow", ci, "postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5");
requireText("CI workflow", ci, "image-ref: codip-production-scan");
requireText("CI workflow", ci, "postgres_ready=false");
requireText("CI workflow", ci, "pg_isready -h 127.0.0.1 -U codip -d codip");
requireText("CI workflow", ci, '-e CODIP_ADMIN_TOKEN="$CODIP_ADMIN_TOKEN"');
requireText("CI workflow", ci, 'grep -q "accepting connections"');
requireText("CI workflow", ci, "severity: CRITICAL,HIGH");
requireText("CI workflow", ci, "ignore-unfixed: true");
requireText("CI workflow", ci, 'exit-code: "1"');
requireText("CI workflow", ci, "scanners: vuln");
requireText("CI workflow", ci, "docker/login-action@af1e73f918a031802d376d3c8bbc3fe56130a9b0");
requireText("CI workflow", ci, "docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c");
requireText("CI workflow", ci, "docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302");
requireText("CI workflow", ci, "docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a");
requireText("CI workflow", ci, "target: runner");
requireText("CI workflow", ci, "push: true");
requireText("CI workflow", ci, "sbom: true");
requireText("CI workflow", ci, "provenance: mode=max");
requireText("PostgreSQL preview compose", composePg, "postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5");
requireText("PostgreSQL preview compose", composePg, "pg_isready -h 127.0.0.1 -U codip -d codip");

if (ci.includes("docker/scout-action")) {
  errors.push("CI workflow must not use Docker Scout for unauthenticated PR image scans");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[docker-release-contract][error] ${error}`);
  process.exit(1);
}

console.log("[docker-release-contract] OK");
