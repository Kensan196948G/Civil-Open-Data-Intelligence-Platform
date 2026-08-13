// k6 ロードテストシナリオ（CODIP）
//
// 使い方:
//   k6 run scripts/load/k6-scenarios.js --env BASE_URL=http://127.0.0.1:3110
//
// 対象: ローカル preview（本番には実行しない）。SLO は docs/runbooks/monitoring.md
// §1.1.2 の「P95 5秒以内」と「エラー率1%未満」を反映する。
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:3110";
const MAX_VUS = Math.min(200, Math.max(1, Math.floor(Number(__ENV.MAX_VUS || 20))));
if (!Number.isFinite(MAX_VUS)) {
  throw new Error("MAX_VUS must be a positive integer between 1 and 200");
}

export const options = {
  scenarios: {
    read: {
      executor: "ramping-vus",
      exec: "readFlow",
      startVUs: 1,
      stages: [
        { duration: "20s", target: Math.min(5, MAX_VUS) },
        { duration: "30s", target: MAX_VUS },
        { duration: "20s", target: 0 },
      ],
      gracefulRampDown: "5s",
    },
    write: {
      executor: "constant-vus",
      exec: "writeFlow",
      vus: Math.min(5, MAX_VUS),
      duration: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<5000"],
    check_failure_rate: ["rate<0.01"],
  },
};

const checkFailures = new Rate("check_failure_rate");
const apiTrend = new Trend("api_duration_ms");

const PUBLIC_GETS = [
  "/api/health",
  "/api/ready",
  "/api/sources",
  "/api/dashboard",
  "/api/v1/layers",
  "/api/openapi",
];

function headers() {
  // VUごとに異なる識別子を送り、実ユーザー相当のレート制限適用を再現する
  // （previewは CODIP_TRUST_PROXY_HEADERS=true で cf-connecting-ip を参照する）。
  return { "cf-connecting-ip": `10.0.0.${__VU}` };
}

export function readFlow() {
  for (const path of PUBLIC_GETS) {
    const res = http.get(`${BASE}${path}`, { headers: headers() });
    const ok = res.status >= 200 && res.status < 500;
    check(res, { [`${path} reachable`]: () => ok });
    checkFailures.add(!ok);
    apiTrend.add(res.timings.duration);
  }

  const search = http.get(
    `${BASE}/api/v1/records/search?q=${encodeURIComponent("河川")}&limit=10`,
    { headers: headers() },
  );
  check(search, { "records/search ok": (r) => r.status === 200 });
  checkFailures.add(search.status !== 200);
  apiTrend.add(search.timings.duration);

  const point = http.get(`${BASE}/api/v1/assessments/point?lat=35.68&lng=139.76&radiusM=5000&categories=all`, {
    headers: headers(),
  });
  check(point, { "assessments/point ok": (r) => r.status === 200 });
  checkFailures.add(point.status !== 200);
  apiTrend.add(point.timings.duration);

  const rec = http.get(`${BASE}/api/v1/recommendations?query=${encodeURIComponent("河川")}`, {
    headers: headers(),
  });
  check(rec, { "recommendations ok": (r) => r.status === 200 });
  checkFailures.add(rec.status !== 200);
  apiTrend.add(rec.timings.duration);

  sleep(0.5);
}

/**
 * 書き込み系・管理系APIのシナリオ（preview限定）。
 * 管理者トークンは --env ADMIN_TOKEN=... で渡す（本番には実行しない）。
 */
export function writeFlow() {
  const adminToken = __ENV.ADMIN_TOKEN || "";
  const authHeaders = adminToken ? { "x-codip-admin-token": adminToken } : {};
  const code = `load-${__VU}-${Date.now()}`;
  const create = http.post(
    `${BASE}/api/v1/sites`,
    JSON.stringify({
      code,
      name: "ロードテスト現場",
      kind: "land",
      lat: 35.68,
      lon: 139.76,
    }),
    {
      headers: {
        ...headers(),
        "content-type": "application/json",
        ...authHeaders,
      },
    },
  );
  const createOk = create.status === 201 || create.status === 409;
  check(create, { "site create ok (201/409)": () => createOk });
  checkFailures.add(!createOk);
  apiTrend.add(create.timings.duration);

  const roles = http.get(`${BASE}/api/admin/roles`, {
    headers: { ...headers(), ...authHeaders },
  });
  check(roles, { "admin roles ok": (r) => r.status === 200 });
  checkFailures.add(roles.status !== 200);
  apiTrend.add(roles.timings.duration);

  sleep(1);
}
