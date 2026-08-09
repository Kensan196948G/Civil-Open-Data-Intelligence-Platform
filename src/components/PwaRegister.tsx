"use client";

import { useEffect } from "react";

/**
 * PWA Service Worker 登録 (docs/design/pwa-mobile-design.md §3.1)。
 * 開発環境では登録しない (E2E/開発のキャッシュ干渉を防ぐ)。
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 登録失敗は致命的ではない (オンライン時は通常動作する)
      });
    };
    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad);
    }
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
