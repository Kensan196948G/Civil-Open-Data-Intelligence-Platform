import Link from "next/link";

export const metadata = {
  title: "ページが見つかりません",
};

// Next.js は not-found.tsx があると 404 ステータスを維持したままこの画面を描画する
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <p className="text-5xl" aria-hidden="true">
        🔍
      </p>
      <h1 className="text-xl font-bold">ページが見つかりません</h1>
      <p className="text-sm text-slate-600">
        URLが変更されたか、ページが削除された可能性があります。
      </p>
      <div className="flex justify-center gap-4 text-sm">
        <Link href="/" className="text-blue-600 underline hover:text-blue-800">
          ダッシュボードへ戻る
        </Link>
        <Link href="/sources" className="text-blue-600 underline hover:text-blue-800">
          データソース一覧を開く
        </Link>
      </div>
    </div>
  );
}
