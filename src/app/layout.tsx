import type { Metadata } from "next";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  // 各ページの title は "%s | ..." に展開される (WCAG 2.4.2: 画面ごとに識別可能な title)
  title: {
    template: "%s | Civil Open Data Intelligence Platform",
    default: "Civil Open Data Intelligence Platform",
  },
  description: "土木建設オープンデータ統合分析基盤",
  // 注意: src/app/icon.svg のメタデータ規約は next-metadata-image-loader が WASM を
  // 使うため本環境ではビルド不能 (next/font と同根)。public/ 静的配信 + URL 参照にする
  icons: {
    icon: { url: "/icon.svg", type: "image/svg+xml" },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="flex h-screen w-full overflow-hidden">
        <PwaRegister />
        {/* デザイン正本指定の IBM Plex フォント。next/font は本環境の WASM メモリ制限で
            ビルド不能のため、正本と同じ <link> 方式 (CSP は fonts.googleapis.com /
            fonts.gstatic.com のみ許可)。CDN 不達時は font stack の system-ui へフォールバック */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font --
            このルールは pages/_document.js 前提。App Router の root layout に置いた
            <link> は全ページへ適用されるため該当しない (公式 docs の適用範囲どおり) */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
        <a href="#main-content" className="skip-link">
          本文へ移動
        </a>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex flex-1 flex-col gap-4 overflow-auto p-[22px]"
          >
            {children}
          </main>
          <footer className="border-t border-[var(--line)] bg-white px-[22px] py-2 text-[11px] text-[var(--muted)]">
            ⚠️ 本システムは公開データの検索・整理・取得確認を支援するものであり、施工可否・安全性・利用条件の最終判断は必ず人間が行います。
          </footer>
        </div>
      </body>
    </html>
  );
}
