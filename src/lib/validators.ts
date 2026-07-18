import { z } from "zod";
import { ACCESS_TYPES, CATEGORIES, DATA_FORMATS } from "@/lib/constants";
import { hasSecretQueryParams, hasUrlCredentials } from "@/lib/url-safety";
import { validateUrl } from "@/lib/url-guard";

const categoryValues = CATEGORIES.map((c) => c.value) as [string, ...string[]];
const formatValues = [...DATA_FORMATS] as [string, ...string[]];
const accessValues = [...ACCESS_TYPES] as [string, ...string[]];

const urlField = z
  .string()
  .trim()
  .url({ message: "URL形式が正しくありません" })
  .refine((value) => validateUrl(value).ok, {
    message: "http/https の公開URLのみ登録できます",
  })
  .refine((value) => !hasUrlCredentials(value), {
    message: "URLにユーザー名・パスワードを含めないでください",
  })
  .refine((value) => !hasSecretQueryParams(value), {
    message: "URLにAPIキー・トークン等の秘密情報を含むクエリを登録しないでください",
  });
const optionalUrlField = z
  .union([urlField, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const API_KEY_HTTPS_MESSAGE = "APIキーを利用するデータソースはHTTPS URLのみ登録できます";

/**
 * requiresApiKey → HTTPS 不変条件を「保存後の実効状態」に対して検査する。
 *
 * この不変条件は複数フィールドにまたがるため、部分更新の payload 単体では
 * 判定できない (Codex review: requiresApiKey だけの更新が誤って拒否される /
 * Codex adversarial review: URL だけを http へ更新すると不変条件が破れる)。
 * 更新系は必ず既存レコードとマージした実効値で本関数を呼ぶこと。
 */
export function apiKeyHttpsInvariantViolation(effective: {
  requiresApiKey: boolean;
  endpointUrl: string | null;
  officialUrl: string | null;
}): { path: "endpointUrl" | "officialUrl"; message: string } | null {
  if (!effective.requiresApiKey) return null;
  const targetUrl = effective.endpointUrl || effective.officialUrl;
  if (isHttpsUrl(targetUrl ?? undefined)) return null;
  return {
    path: effective.endpointUrl ? "endpointUrl" : "officialUrl",
    message: API_KEY_HTTPS_MESSAGE,
  };
}

function enforceApiKeyHttps(
  data: { requiresApiKey?: boolean; officialUrl?: string; endpointUrl?: string | null },
  ctx: z.RefinementCtx,
) {
  const violation = apiKeyHttpsInvariantViolation({
    requiresApiKey: data.requiresApiKey ?? false,
    endpointUrl: data.endpointUrl ?? null,
    officialUrl: data.officialUrl ?? null,
  });
  if (violation) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [violation.path],
      message: violation.message,
    });
  }
}

function booleanField(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (value === undefined) return undefined;
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return true;
        if (normalized === "false") return false;
      }
      return value;
    }, z.boolean({ invalid_type_error: "true または false を指定してください" }))
    .default(defaultValue);
}

const dataSourceBaseSchema = z.object({
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
  requiresApiKey: booleanField(false),
  apiKeyEnvName: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]*$/, "環境変数名は英大文字・数字・_のみ")
    .max(100)
    .optional()
    .transform((v) => v || null),
  licenseName: z.string().trim().max(300).optional().transform((v) => v || null),
  commercialUse: z.enum(["allowed", "restricted", "unknown"]).default("unknown"),
  attributionRequired: booleanField(true),
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

export const dataSourceCreateSchema = dataSourceBaseSchema.superRefine(enforceApiKeyHttps);

// 注意: update schema には enforceApiKeyHttps を付けない。
// 部分更新では payload 単体で requiresApiKey→HTTPS 不変条件を判定できないため、
// PUT route が既存レコードとマージした実効状態に対して
// apiKeyHttpsInvariantViolation で検査する (単一の検査点)。
export const dataSourceUpdateSchema = dataSourceBaseSchema.partial();

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
