// 本番スモーク負荷シナリオ（承認後に実施・段階的・read-only）
//
// 使い方:
//   k6 run scripts/load/k6-production-scenario.js \
//     --env BASE_URL=https://odip.mirai-dx-platform.com \
//     --env CF_ACCESS_CLIENT_ID=... --env CF_ACCESS_CLIENT_SECRET=... \
//     --env MAX_VUS=5
//
// Cloudflare Access 配下の read-only エンドポイントのみを対象とし、書き込み系・
// 管理系には触れない。MAX_VUS は小さく始め（5→10→20）、本番SLO（P95 5秒）を確認する。
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "https://odip.mirai-dx-platform.com";
const MAX_VUS = Math.min(20, Math.max(1, Math.floor(Number(__ENV.MAX_VUS || 5))));

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "15s", target: 1 },
        { duration: "30s", target: MAX_VUS },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "5s",
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

function headers() {
  const clientId = __ENV.CF_ACCESS_CLIENT_ID || "";
  const clientSecret = __ENV.CF_ACCESS_CLIENT_SECRET || "";
  return {
    "cf-connecting-ip": `10.10.${Math.floor(__VU / 250)}.${(__VU % 250) + 1}`,
    ...(clientId && clientSecret
      ? {
          "CF-Access-Client-Id": clientId,
          "CF-Access-Client-Secret": clientSecret,
        }
      : {}),
  };
}

const PATHS = [
  "/api/health",
  "/api/ready",
  "/api/sources",
  "/api/dashboard",
  "/api/v1/layers",
  "/api/v1/records/search?q=%E6%B2%B3%E5%B7%9D&limit=5",
];

export default function () {
  for (const path of PATHS) {
    const res = http.get(`${BASE}${path}`, { headers: headers() });
    const ok = res.status === 200;
    check(res, { [`${path} 200`]: () => ok });
    checkFailures.add(!ok);
    apiTrend.add(res.timings.duration);
    sleep(0.5);
  }
}
