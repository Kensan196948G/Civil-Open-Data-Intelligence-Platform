import { sanitizeUrl } from "@/lib/url-safety";

const MAX_ERROR_MESSAGE_LENGTH = 1000;
const MAX_PREVIEW_TEXT_LENGTH = 4000;
const SECRET_ASSIGNMENT_PATTERN =
  /(["']?\b(access_token|api[-_]?key|apikey|app[_-]?id|client_secret|code|key|password|secret|subscription-key|token|x-api-key)\b["']?\s*[:=]\s*)(["'][^"']*["']|[^&\s,}]+)/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g;
const BASIC_AUTH_PATTERN = /\bBasic\s+[A-Za-z0-9+/]+=*/g;

export function redactOperationalText(value: string, maxLength = MAX_ERROR_MESSAGE_LENGTH): string {
  return value
    .replace(SECRET_ASSIGNMENT_PATTERN, (_match, prefix, _key, rawValue) => {
      const quote = rawValue.startsWith('"') || rawValue.startsWith("'") ? rawValue[0] : "";
      return `${prefix}${quote}***${quote}`;
    })
    .replace(BEARER_PATTERN, "Bearer ***")
    .replace(BASIC_AUTH_PATTERN, "Basic ***")
    .slice(0, maxLength);
}

export function safeFetchLogDto<T extends { requestUrl: string; errorMessage?: string | null }>(
  log: T,
): T {
  return {
    ...log,
    requestUrl: sanitizeUrl(log.requestUrl),
    errorMessage: log.errorMessage ? redactOperationalText(log.errorMessage) : log.errorMessage,
  };
}

export function safeSampleResponseDto<T extends { previewText?: string | null }>(sample: T): T {
  return {
    ...sample,
    previewText: sample.previewText
      ? redactOperationalText(sample.previewText, MAX_PREVIEW_TEXT_LENGTH)
      : sample.previewText,
  };
}
