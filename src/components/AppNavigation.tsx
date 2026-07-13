"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "🏠 ダッシュボード" },
  { href: "/sources", label: "📚 データソース" },
  { href: "/map", label: "🗺️ 地図" },
  { href: "/logs", label: "🧾 取得ログ" },
  { href: "/tags", label: "🏷️ タグ" },
  { href: "/settings", label: "⚙️ 設定" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNavigation() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 text-sm md:gap-4" aria-label="主要ナビゲーション">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded bg-slate-700 px-2 py-1 text-white"
                : "rounded px-2 py-1 hover:bg-slate-700"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
