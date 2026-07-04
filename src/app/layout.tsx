import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Civil Open Data Intelligence Platform",
  description: "土木建設オープンデータ統合分析基盤",
};

const NAV_ITEMS = [
  { href: "/", label: "🏠 ダッシュボード" },
  { href: "/sources", label: "📚 データソース" },
  { href: "/map", label: "🗺️ 地図" },
  { href: "/logs", label: "🧾 取得ログ" },
  { href: "/tags", label: "🏷️ タグ" },
  { href: "/settings", label: "⚙️ 設定" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <header className="bg-slate-900 text-white">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="text-lg font-bold">
              🏗️ Civil Open Data Intelligence
            </Link>
            <nav className="flex gap-4 text-sm">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2 py-1 hover:bg-slate-700"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-slate-500">
          ⚠️ 本システムは公開データの検索・整理・取得確認を支援するものであり、施工可否・安全性・利用条件の最終判断は必ず人間が行います。
        </footer>
      </body>
    </html>
  );
}
