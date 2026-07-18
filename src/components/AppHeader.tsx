"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";

// デザイン正本の VIEW_META と同一
const VIEW_META: { prefix: string; exact?: boolean; title: string; sub: string }[] = [
  { prefix: "/", exact: true, title: "🏠 ダッシュボード", sub: "登録データソースの状況を一目で確認" },
  { prefix: "/sources/new", title: "➕ データソース新規登録", sub: "公開データ・公開APIを台帳に追加" },
  { prefix: "/sources", title: "📚 データソース一覧", sub: "公開データ・公開APIを検索・絞り込み" },
  { prefix: "/map", title: "🗺️ 地図表示", sub: "地理院タイル・標高取得" },
  { prefix: "/logs", title: "🧾 取得ログ一覧", sub: "接続確認・サンプル取得の実行履歴" },
  { prefix: "/audit", title: "🔍 監査ログ", sub: "操作・イベントの証跡とエクスポート" },
  { prefix: "/tags", title: "🏷️ タグ管理", sub: "データソースの分類タグを管理" },
  { prefix: "/settings", title: "⚙️ 設定", sub: "接続確認の動作設定とセキュリティ制約" },
];

function metaFor(pathname: string) {
  if (pathname === "/") return VIEW_META[0];
  if (/^\/sources\/[^/]+\/edit$/.test(pathname))
    return { title: "✏️ データソース編集", sub: "登録内容を更新" };
  if (/^\/sources\/[^/]+$/.test(pathname) && pathname !== "/sources/new")
    return { title: "📄 データソース詳細", sub: "接続確認・品質評価・取得ログ" };
  const hit = VIEW_META.find((m) => (m.exact ? pathname === m.prefix : pathname.startsWith(m.prefix)));
  return hit ?? VIEW_META[0];
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const meta = metaFor(pathname);

  function submitSearch() {
    const q = query.trim();
    router.push(q ? `/sources?q=${encodeURIComponent(q)}` : "/sources");
  }

  return (
    <header className="flex h-[62px] flex-shrink-0 items-center gap-4 border-b border-[var(--line)] bg-white px-[22px]">
      <div>
        <div className="text-base font-semibold leading-[1.2] text-[var(--ink)]">{meta.title}</div>
        <div className="text-[11.5px] text-[var(--muted)]">{meta.sub}</div>
      </div>
      <div className="flex-1"></div>
      <div className="flex items-center gap-[7px] rounded-lg border border-[var(--line)] bg-[var(--subtle)] px-[11px] py-[7px] text-[var(--muted)]">
        <span aria-hidden="true">🔍</span>
        <input
          aria-label="データソースを検索"
          className="w-[190px] border-none bg-transparent text-[12.5px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
          placeholder="データソースを検索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
          }}
        />
      </div>
      <div className="hidden items-center gap-[6px] rounded-[7px] bg-[var(--green-bg)] px-[10px] py-[6px] text-xs font-semibold text-[var(--green)] md:flex">
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] rounded-full bg-[var(--green-2)] shadow-[0_0_0_3px_rgba(46,158,107,0.18)]"
        ></span>
        公開データのみ
      </div>
    </header>
  );
}
