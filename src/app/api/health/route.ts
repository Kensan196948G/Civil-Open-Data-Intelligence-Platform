import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "civil-open-data-intelligence-platform",
    checkedAt: new Date().toISOString(),
  });
}
