import type { NextConfig } from "next";

const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp",
      "connect-src 'self' https://cyberjapandata.gsi.go.jp",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
  },
  webpack(config) {
    // The default webpack hash path can instantiate a Wasm xxhash module.
    // Some constrained Linux shells cap virtual memory in a way that makes that
    // fail before the app starts, so use Node's crypto-backed hash instead.
    config.output.hashFunction = "sha256";
    for (const plugin of config.plugins ?? []) {
      if (
        plugin &&
        typeof plugin === "object" &&
        "name" in plugin &&
        typeof plugin.name === "string"
      ) {
        plugin.name = plugin.name.replaceAll("[hash]", "[sha256:hash]");
      }
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
