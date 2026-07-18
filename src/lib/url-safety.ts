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
    // 解析できないURLは安全側に倒し、資格情報を含む可能性があるものとして扱う
    return true;
  }
}

/**
 * 秘密情報らしきクエリパラメータ名を列挙する。解析できないURLは`[]`を返す(fail-open)。
 * 安全性判定(ブロックするか否か)には使わず、`hasSecretQueryParams`(fail-closed)を使うこと。
 */
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
  try {
    new URL(value);
  } catch {
    // 解析できないURLは安全側に倒し、秘密パラメータを含む可能性があるものとして扱う
    return true;
  }
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
    // 解析できない入力は元の文字列を漏らさず、固定の安全な表現を返す
    return "[invalid-url]";
  }
}
