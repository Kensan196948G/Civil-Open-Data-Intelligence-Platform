import net from "node:net";
import dns from "node:dns/promises";

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; reason: string };

/** RFC1918 / loopback / link-local / メタデータ等の非公開IPを判定する */
export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // CGN 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
      return true; // link-local fe80::/10
    if (lower.startsWith("::ffff:")) {
      return isPrivateIp(lower.slice("::ffff:".length)); // IPv4-mapped
    }
    return false;
  }
  return false;
}

const BLOCKED_HOSTNAMES = ["localhost", "localhost.localdomain"];
const BLOCKED_SUFFIXES = [".local", ".internal", ".localdomain", ".lan", ".corp", ".home"];

/**
 * SSRF対策: 取得対象URLの静的検証。
 * http/https 以外、localhost、private IP リテラル、内部ドメインを拒否する。
 */
export function validateUrl(urlStr: string): UrlGuardResult {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "URL形式が正しくありません" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "http/https 以外のスキームは許可されていません" };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { ok: false, reason: "localhost への取得は禁止されています" };
  }
  if (BLOCKED_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return { ok: false, reason: "内部ドメインへの取得は禁止されています" };
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    return { ok: false, reason: "private IP への取得は禁止されています" };
  }
  return { ok: true, url };
}

/**
 * SSRF対策: DNS解決結果も含めて非公開IPでないことを検証する。
 */
export async function assertSafeUrl(urlStr: string): Promise<UrlGuardResult> {
  const staticResult = validateUrl(urlStr);
  if (!staticResult.ok) return staticResult;
  const { url } = staticResult;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return staticResult;
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        return { ok: false, reason: "内部ネットワークへ解決されるホストは禁止されています" };
      }
    }
  } catch {
    return { ok: false, reason: "ホスト名を解決できませんでした" };
  }
  return staticResult;
}
