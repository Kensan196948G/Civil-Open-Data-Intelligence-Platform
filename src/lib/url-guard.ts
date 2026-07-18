import net from "node:net";
import dns from "node:dns/promises";

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; reason: string };

/** IPv6 文字列を16バイト配列へ展開する。パース不能なら null */
export function ipv6ToBytes(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  let headStr: string;
  let tailStr: string | null = null;
  const dc = ip.indexOf("::");
  if (dc !== -1) {
    headStr = ip.slice(0, dc);
    tailStr = ip.slice(dc + 2);
    if (tailStr.includes(":") && tailStr.includes("::")) return null;
    if (tailStr.includes("::")) return null;
  } else {
    headStr = ip;
  }

  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    const parts = s.split(":");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.includes(".")) {
        // 末尾グループの埋め込みIPv4 (例: ::ffff:127.0.0.1)
        if (i !== parts.length - 1) return null;
        const seg = p.split(".").map(Number);
        if (seg.length !== 4 || seg.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        out.push((seg[0] << 8) | seg[1], (seg[2] << 8) | seg[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
        out.push(parseInt(p, 16));
      }
    }
    return out;
  };

  const head = parseGroups(headStr);
  if (head === null) return null;

  let groups: number[];
  if (tailStr !== null) {
    const tail = parseGroups(tailStr);
    if (tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

function isPrivateIpv4(ip: string): boolean {
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

function isPrivateIpv6Bytes(b: number[]): boolean {
  const allZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // :: (unspecified) / ::1 (loopback)
  if (allZero(0, 15) && (b[15] === 0 || b[15] === 1)) return true;
  // IPv4-mapped ::ffff:0:0/96 (16進表記・ドット表記の双方をバイト列で判定)
  if (allZero(0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // IPv4-compatible ::/96 (非推奨表記)
  if (allZero(0, 12)) {
    return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // NAT64 64:ff9b::/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && allZero(4, 12)) {
    return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // ULA fc00::/7
  if ((b[0] & 0xfe) === 0xfc) return true;
  // link-local fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  return false;
}

/** RFC1918 / loopback / link-local / メタデータ等の非公開IPを判定する */
export function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) {
    const bytes = ipv6ToBytes(ip);
    // パース不能な IPv6 は安全側で「非公開」扱いにして拒否する
    if (!bytes) return true;
    return isPrivateIpv6Bytes(bytes);
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
 * 注意: DNS rebinding 対策の本命は http-client の接続時ピン留め。
 * この関数は事前チェック用であり、単独では TOCTOU を防げない。
 *
 * Issue #18: Cloudflare Workers の nodejs_compat では dns.lookup / lookupService /
 * resolve が "Not implemented" を throw する (公式 changelog 2025-01-28)。
 * サポートされている resolve4 / resolve6 を併用する。resolve系は OS リゾルバ
 * (/etc/hosts) を経由しない直接 DNS 照会だが、事前チェックの目的 (公開 DNS 上で
 * 内部 IP へ解決されるホストの早期拒否) には十分で、最終防御は接続時ピン留めが担う。
 */
export async function assertSafeUrl(urlStr: string): Promise<UrlGuardResult> {
  const staticResult = validateUrl(urlStr);
  if (!staticResult.ok) return staticResult;
  const { url } = staticResult;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return staticResult;

  const [v4, v6] = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  const addresses = [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
  // 両方失敗 (NXDOMAIN・DNS障害・未実装環境での想定外エラー) は fail-closed
  if (addresses.length === 0) {
    return { ok: false, reason: "ホスト名を解決できませんでした" };
  }
  for (const address of addresses) {
    if (isPrivateIp(address)) {
      return { ok: false, reason: "内部ネットワークへ解決されるホストは禁止されています" };
    }
  }
  return staticResult;
}
