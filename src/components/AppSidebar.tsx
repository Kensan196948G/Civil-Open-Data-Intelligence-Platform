"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// デザイン正本 (docs/design/) の navDef と同一構成
const NAV_GROUPS: { label: string; items: { href: string; icon: string; label: string }[] }[] = [
  { label: "運用", items: [{ href: "/", icon: "🏠", label: "ダッシュボード" }] },
  {
    label: "データ台帳",
    items: [
      { href: "/sources", icon: "📚", label: "データソース" },
      { href: "/map", icon: "🗺️", label: "地図" },
    ],
  },
  {
    label: "地形・気象判断",
    items: [
      { href: "/terrain", icon: "⛰️", label: "地形分析" },
      { href: "/weather", icon: "🌦️", label: "気象・海象" },
      { href: "/sites", icon: "🚧", label: "現場管理" },
      { href: "/decisions", icon: "🧭", label: "施工可否判定" },
      { href: "/reports", icon: "📊", label: "レポート" },
    ],
  },
  {
    label: "記録・管理",
    items: [
      { href: "/logs", icon: "🧾", label: "取得ログ" },
      { href: "/audit", icon: "🔍", label: "監査ログ" },
      { href: "/tags", icon: "🏷️", label: "タグ管理" },
      { href: "/settings", icon: "⚙️", label: "設定" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    // デザインは 250px 固定サイドバー。モバイル (<lg) ではアイコンのみへ折りたたみ、
    // ラベルは sr-only でアクセシブルネームを維持する
    <aside className="flex h-full w-16 flex-shrink-0 flex-col border-r border-[var(--side-line)] bg-[var(--side)] text-[var(--side-fg)] lg:w-[250px]">
      <div className="flex items-center justify-center gap-[11px] border-b border-[var(--side-line)] px-2 pb-4 pt-[18px] lg:justify-start lg:px-[18px]">
        <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 21h18"></path>
            <path d="M5 21V7l8-4v18"></path>
            <path d="M19 21V11l-6-4"></path>
          </svg>
        </span>
        <div className="hidden leading-[1.2] lg:block">
          <div className="text-[14.5px] font-semibold tracking-[0.2px] text-[var(--ink)]">
            Civil Open Data
          </div>
          <div className="text-[11px] text-[var(--side-muted)]">Intelligence Platform</div>
        </div>
      </div>

      <nav
        aria-label="主要ナビゲーション"
        className="flex flex-1 flex-col gap-px overflow-y-auto px-3 pb-[14px] pt-[10px]"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="contents">
            <div className="hidden px-2 pb-[6px] pt-[13px] text-[10px] font-semibold tracking-[1px] text-[var(--side-label)] lg:block">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "relative flex items-center justify-center gap-[10px] rounded-[7px] bg-[var(--side-2)] px-[11px] py-2 text-[13px] font-medium text-[var(--ink)] lg:justify-start"
                      : "relative flex items-center justify-center gap-[10px] rounded-[7px] px-[11px] py-2 text-[13px] font-medium text-[var(--side-fg)] hover:bg-[var(--hover)] lg:justify-start"
                  }
                >
                  <span
                    aria-hidden="true"
                    className="absolute bottom-2 left-0 top-2 w-[3px] rounded-[2px]"
                    style={{ background: active ? "var(--accent)" : "transparent" }}
                  ></span>
                  <span className="w-[18px] flex-shrink-0 text-center">{item.icon}</span>
                  <span className="sr-only lg:not-sr-only lg:flex-1 lg:overflow-hidden lg:text-ellipsis lg:whitespace-nowrap">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-center gap-[11px] border-t border-[var(--side-line)] px-2 py-[13px] lg:justify-start lg:px-[14px]">
        <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--subtle)] text-[15px] font-semibold text-[var(--ink)]">
          🛰️
        </span>
        <div className="hidden flex-1 leading-[1.25] lg:block">
          <div className="text-[13px] font-medium text-[var(--ink)]">オープンデータ基盤</div>
          <div className="text-[11px] text-[var(--side-muted)]">ローカル環境</div>
        </div>
        <span className="hidden rounded-[5px] border border-[rgba(224,138,43,0.4)] px-[6px] py-px text-[10px] font-semibold text-[var(--accent)] lg:inline">
          MVP
        </span>
      </div>
    </aside>
  );
}
