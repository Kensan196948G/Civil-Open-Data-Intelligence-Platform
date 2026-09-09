import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * 稼働確認と「今どのリリースが配信されているか」の申告 (Issue #231)。
 *
 * 本番は以前、開発の作業ディレクトリから `next start` していた。稼働中に `.next`
 * が作り直されると、配信中のHTMLが参照する chunk がディスクから消えて 404/400 に
 * なる。実際 2026-09-09 にこれが起きたが、**どの commit を配信しているのかを
 * 確認する手段が無く**、systemd の起動時刻から推測するしかなかった。
 *
 * リリース識別子を応答へ載せ、外形から確認できるようにする。値は deploy 時に
 * systemd の EnvironmentFile 経由で与える。未設定なら "unknown" を返す
 * (「設定し忘れ」を「開発環境」と区別できるよう、空文字で誤魔化さない)。
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "civil-open-data-intelligence-platform",
    release: {
      commit: process.env.CODIP_RELEASE_SHA || "unknown",
      deployedAt: process.env.CODIP_RELEASE_DEPLOYED_AT || "unknown",
    },
    checkedAt: new Date().toISOString(),
  });
}
