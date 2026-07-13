const SECRET_QUERY_PARAMS = new Set([
  "access_token",
  "api-key",
  "api_key",
  "apikey",
  "app_id",
  "appid",
  "client_secret",
  "code",
  "key",
  "password",
  "sig",
  "signature",
  "secret",
  "subscription-key",
  "token",
]);

export function hasUrlCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

export function secretQueryParamNames(value: string): string[] {
  try {
    const url = new URL(value);
    return [...url.searchParams.keys()].filter((name) =>
      SECRET_QUERY_PARAMS.has(name.toLowerCase()),
    );
  } catch {
    return [];
  }
}

export function hasSecretQueryParams(value: string): boolean {
  return secretQueryParamNames(value).length > 0;
}

/** クエリ内の秘密情報らしきパラメータをマスクしてログ・公開レスポンス安全にする */
export function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.username = "";
    url.password = "";
    for (const [name] of url.searchParams) {
      if (SECRET_QUERY_PARAMS.has(name.toLowerCase())) {
        url.searchParams.set(name, "***");
      }
    }
    return url.toString();
  } catch {
    return urlStr;
  }
}
