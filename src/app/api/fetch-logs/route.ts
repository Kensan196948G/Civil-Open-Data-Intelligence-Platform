import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const dataSourceId = sp.get("dataSourceId")?.trim();
  const success = sp.get("success");
  const take = Math.min(Number(sp.get("take") ?? 100), 1000);

  const logs = await prisma.fetchLog.findMany({
    where: {
      ...(dataSourceId ? { dataSourceId } : {}),
      ...(success === "true" ? { success: true } : {}),
      ...(success === "false" ? { success: false } : {}),
    },
    include: { dataSource: { select: { id: true, name: true } } },
    orderBy: { executedAt: "desc" },
    take,
  });

  return NextResponse.json({ items: logs });
}
