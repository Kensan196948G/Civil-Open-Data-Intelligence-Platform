import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const dataSourceId = sp.get("dataSourceId")?.trim();
  const success = sp.get("success");
  const rawTake = sp.get("take");
  const take = rawTake === null || rawTake === "" ? 100 : Number(rawTake);
  if (!Number.isInteger(take) || take < 1 || take > 1000) {
    return NextResponse.json(
      { error: "validation_error", message: "take の値が不正です" },
      { status: 400 },
    );
  }

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
