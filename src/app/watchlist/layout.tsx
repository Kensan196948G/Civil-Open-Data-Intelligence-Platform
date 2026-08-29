// watchlist ページは client component（"use client"）のため metadata を直接
// export できない。ルート layout（server component）でタイトルを提供する。
// これがないと <title> が既定の "Civil Open Data Intelligence Platform" に
// フォールバックし、WCAG 2.4.2（画面ごとに識別可能な title）を満たさない。
export const metadata = {
  title: "🔔 ウォッチリスト",
};

export default function WatchlistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
