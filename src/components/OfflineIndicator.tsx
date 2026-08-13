"use client";

import { useEffect, useState } from "react";

/**
 * オフライン時の注意表示（PWAオフライン戦略 docs/design/pwa-mobile-design.md）。
 * キャッシュ表示中であることを利用者へ明示し、データ鮮度の誤解を防ぐ。
 */
export function OfflineIndicator() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      data-testid="offline-indicator"
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-[var(--amber)] px-4 py-1.5 text-center text-[12px] font-semibold text-[var(--ink)]"
    >
      📡 オフラインです。キャッシュされた情報を表示しています。接続復旧後に自動更新します。
    </div>
  );
}
