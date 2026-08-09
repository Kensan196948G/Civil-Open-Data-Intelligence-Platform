import type { MetadataRoute } from "next";

// PWAマニフェスト (docs/design/pwa-mobile-design.md §3.1)。
// アイコンは public/icon.svg を参照 (Next metadata image loader は本環境でビルド不能のため静的配信)。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Civil Open Data Intelligence Platform",
    short_name: "CODIP",
    description: "土木建設オープンデータ統合分析基盤",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#eef1f5",
    theme_color: "#e08a2b",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
