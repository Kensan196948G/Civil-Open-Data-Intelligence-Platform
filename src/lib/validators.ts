import { z } from "zod";
import { ACCESS_TYPES, CATEGORIES, DATA_FORMATS } from "@/lib/constants";

const categoryValues = CATEGORIES.map((c) => c.value) as [string, ...string[]];
const formatValues = [...DATA_FORMATS] as [string, ...string[]];
const accessValues = [...ACCESS_TYPES] as [string, ...string[]];

const urlField = z.string().trim().url({ message: "URL形式が正しくありません" });
const optionalUrlField = z
  .union([urlField, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

export const dataSourceCreateSchema = z.object({
  name: z.string().trim().min(1, "データソース名は必須です").max(200),
  nameEn: z.string().trim().max(200).optional().transform((v) => v || null),
  providerId: z.string().trim().min(1).optional(),
  providerName: z.string().trim().max(200).optional(),
  providerOrganizationType: z
    .enum(["national", "local", "private", "community"])
    .optional(),
  description: z.string().trim().max(4000).optional().transform((v) => v || null),
  officialUrl: urlField,
  endpointUrl: optionalUrlField,
  documentationUrl: optionalUrlField,
  category: z.enum(categoryValues),
  dataFormat: z.enum(formatValues),
  accessType: z.enum(accessValues),
  requiresApiKey: z.coerce.boolean().default(false),
  apiKeyEnvName: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]*$/, "環境変数名は英大文字・数字・_のみ")
    .max(100)
    .optional()
    .transform((v) => v || null),
  licenseName: z.string().trim().max(300).optional().transform((v) => v || null),
  commercialUse: z.enum(["allowed", "restricted", "unknown"]).default("unknown"),
  attributionRequired: z.coerce.boolean().default(true),
  updateFrequency: z.string().trim().max(100).optional().transform((v) => v || null),
  status: z.enum(["active", "unstable", "deprecated", "unknown"]).default("unknown"),
  trustLevel: z.coerce.number().int().min(1, "信頼度は1〜5").max(5, "信頼度は1〜5").default(3),
  qualityScore: z.coerce
    .number()
    .int()
    .min(0, "品質スコアは0〜100")
    .max(100, "品質スコアは0〜100")
    .default(0),
  note: z.string().trim().max(4000).optional().transform((v) => v || null),
  updatedBy: z.string().trim().max(100).optional().transform((v) => v || null),
  tagIds: z.array(z.string()).optional(),
});

export const dataSourceUpdateSchema = dataSourceCreateSchema.partial();

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1, "タグ名は必須です").max(100),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "色は #rrggbb 形式")
    .optional()
    .transform((v) => v || null),
});

export const checkRequestSchema = z.object({
  method: z.enum(["GET", "HEAD"]).default("GET"),
});

export type DataSourceCreateInput = z.infer<typeof dataSourceCreateSchema>;
export type DataSourceUpdateInput = z.infer<typeof dataSourceUpdateSchema>;
