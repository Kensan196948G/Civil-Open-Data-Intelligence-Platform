import type { Metadata } from "next";
import Link from "next/link";
import { AppNavigation } from "@/components/AppNavigation";
import "./globals.css";

export const metadata: Metadata = {
  // 各ページの title は "%s | ..." に展開される (WCAG 2.4.2: 画面ごとに識別可能な title)
  title: {
    template: "%s | Civil Open Data Intelligence Platform",
    default: "Civil Open Data Intelligence Platform",
  },
  description: "土木建設オープンデータ統合分析基盤",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <a href="#main-content" className="skip-link">
          本文へ移動
        </a>
        <header className="bg-slate-900 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-6">
            <Link href="/" className="text-base font-bold md:text-lg">
              🏗️ Civil Open Data Intelligence
            </Link>
            <AppNavigation />
          </div>
        </header>
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-6" tabIndex={-1}>
          {children}
        </main>
        <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-slate-500">
          ⚠️ 本システムは公開データの検索・整理・取得確認を支援するものであり、施工可否・安全性・利用条件の最終判断は必ず人間が行います。
        </footer>
      </body>
    </html>
  );
}
