"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { tagCreateSchema } from "@/lib/validators";

export type TagActionState = { error?: string };

export async function createTagAction(
  _prev: TagActionState,
  formData: FormData,
): Promise<TagActionState> {
  const parsed = tagCreateSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  }
  const existing = await prisma.tag.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return { error: "同名のタグが既に存在します" };
  }
  await prisma.tag.create({ data: parsed.data });
  revalidatePath("/tags");
  return {};
}
