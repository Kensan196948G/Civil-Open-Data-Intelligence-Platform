import type { NextConfig } from "next";

const isCloudflareBuild = process.env.CODIP_CLOUDFLARE_BUILD === "true";

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
      // fonts.googleapis.com / fonts.gstatic.com はデザイン正本 (docs/design/) 指定の
      // IBM Plex フォント配信のみに使用。next/font はこの環境の WASM メモリ制限
      // (上記 webpack ワークアラウンドと同根) でビルド不能のため <link> 方式を採用
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // OSM タイルはモック完全一致の人間判断 (2026-07-18) による。GSI は標高 API 等で残置
      "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp https://*.tile.openstreetmap.org",
      "connect-src 'self' https://cyberjapandata.gsi.go.jp",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
  },
  // Prisma clients must stay external to the webpack bundle: their package.json
  // exports select a wasm query engine under the `workerd` condition, and that
  // selection can only happen when wrangler (not webpack) resolves the import
  // during the Workers deploy (see opennext.js.org/cloudflare/howtos/db).
  serverExternalPackages: ["@prisma/client", ".prisma/client", ".prisma/client-postgresql"],
  webpack(config, { isServer }) {
    if (isServer) {
      // serverExternalPackages does not reliably match the dot-leading pseudo
      // package (`.prisma/...` parses as package ".prisma" + subpath), so the
      // /wasm entry would get bundled and webpack would choke on the .wasm
      // import. Externalize both entries explicitly; wrangler resolves them
      // (including the wasm module) when it bundles the Worker at deploy.
      // OpenNext invokes `npm run build` before Wrangler bundles the Worker.
      // At that earlier stage, replace the local SQLite client with the same
      // PostgreSQL wasm entry used at runtime; otherwise both generated wasm
      // engines are traced and uploaded. Normal Node builds keep SQLite.
      config.externals.unshift({
        ...(isCloudflareBuild
          ? { "@prisma/client": "commonjs .prisma/client-postgresql/wasm" }
          : {}),
        ".prisma/client-postgresql": "commonjs .prisma/client-postgresql",
        ".prisma/client-postgresql/wasm": "commonjs .prisma/client-postgresql/wasm",
      });
    }
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
