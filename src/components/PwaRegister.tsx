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
    const requestSync = (registration: ServiceWorkerRegistration) => {
      // lib.dom に sync 型が無い環境でも動作するよう、最小インターフェースで扱う
      const withSync = registration as unknown as {
        sync?: { register: (tag: string) => Promise<void> };
      };
      if (withSync.sync) {
        withSync.sync.register("codip-revalidate-apis").catch(() => {});
      } else {
        // Background Sync 非対応ブラウザはオンライン時の通常動作に委ねる
      }
    };
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          requestSync(registration);
          // オフライン→オンライン復帰時にも API キャッシュを再検証する
          window.addEventListener("online", () => requestSync(registration));
        })
        .catch(() => {
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
