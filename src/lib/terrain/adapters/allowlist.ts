/**
 * SSRF (Server-Side Request Forgery) defenses for outbound source URLs.
 *
 * URLs are never assembled directly from user input: the source registry holds
 * URL templates into which only validated z/x/y values are interpolated. This
 * module is the final gate that checks an already-assembled URL before it is
 * ever fetched.
 *
 * Scope note (Sprint 0): this validates the hostname *string* only. It does NOT
 * resolve the hostname via DNS. A hostname that is in the allowlist but resolves
 * to a private/internal IP (DNS rebinding) is therefore NOT caught here. Before
 * any real network fetch is implemented, the resolved IP must be re-checked
 * against the same private-range rules (pin the resolved address for the fetch).
 */

export interface UrlSafetyOptions {
  /** Exact hostnames (case-insensitive) that are permitted. */
  readonly allowedHosts: readonly string[];
}

export interface UrlSafetyResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

function reject(reason: string): UrlSafetyResult {
  return { allowed: false, reason };
}

/**
 * Parse a canonical dotted-decimal IPv4 string into a 32-bit unsigned integer.
 * Returns null if the string is not an IPv4 literal.
 */
function parseIpv4ToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

interface Ipv4Range {
  readonly prefix: number;
  readonly bits: number;
}

function ipv4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// Private, loopback and link-local ranges that must never be fetched directly.
const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  { prefix: ipv4(127, 0, 0, 0), bits: 8 }, // loopback 127.0.0.0/8
  { prefix: ipv4(10, 0, 0, 0), bits: 8 }, // private 10.0.0.0/8
  { prefix: ipv4(172, 16, 0, 0), bits: 12 }, // private 172.16.0.0/12
  { prefix: ipv4(192, 168, 0, 0), bits: 16 }, // private 192.168.0.0/16
  { prefix: ipv4(169, 254, 0, 0), bits: 16 }, // link-local 169.254.0.0/16
];

function isBlockedIpv4(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(({ prefix, bits }) => {
    // Bitwise ops yield signed int32; normalize both sides with `>>> 0`.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (prefix & mask) >>> 0;
  });
}

/**
 * Parse an IPv6 literal (already stripped of surrounding brackets) into its 16
 * bytes. Handles `::` compression and a trailing embedded IPv4 group. Returns
 * null when the input is not a valid IPv6 address.
 */
function parseIpv6ToBytes(input: string): Uint8Array | null {
  // Drop any zone id (e.g. `fe80::1%eth0`) before classification.
  const percent = input.indexOf("%");
  const host = percent === -1 ? input : input.slice(0, percent);

  const halves = host.split("::");
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;

  const headStr = halves[0] ?? "";
  const tailStr = compressed ? (halves[1] ?? "") : "";
  const headGroups = headStr === "" ? [] : headStr.split(":");
  const tailGroups = tailStr === "" ? [] : tailStr.split(":");

  const encode = (groups: readonly string[], out: number[]): boolean => {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group === undefined) return false;
      if (group.includes(".")) {
        // Embedded IPv4 is only valid as the final group.
        if (i !== groups.length - 1) return false;
        const v4 = parseIpv4ToInt(group);
        if (v4 === null) return false;
        out.push((v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return false;
      const hextet = parseInt(group, 16);
      out.push((hextet >>> 8) & 0xff, hextet & 0xff);
    }
    return true;
  };

  const headBytes: number[] = [];
  const tailBytes: number[] = [];
  if (!encode(headGroups, headBytes)) return null;
  if (!encode(tailGroups, tailBytes)) return null;

  let bytes: number[];
  if (compressed) {
    const zeros = 16 - headBytes.length - tailBytes.length;
    if (zeros < 0) return null;
    bytes = [...headBytes, ...new Array<number>(zeros).fill(0), ...tailBytes];
  } else {
    bytes = headBytes;
  }

  if (bytes.length !== 16) return null;
  return Uint8Array.from(bytes);
}

function isBlockedIpv6(bytes: Uint8Array): boolean {
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;

  // ::1 loopback
  const isLoopback = bytes.every((byte, i) => (i === 15 ? byte === 1 : byte === 0));
  if (isLoopback) return true;

  // fc00::/7 unique local address
  if ((b0 & 0xfe) === 0xfc) return true;

  // fe80::/10 link-local
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true;

  // IPv4-mapped (::ffff:a.b.c.d): re-apply the IPv4 rules to the embedded address
  // so `[::ffff:127.0.0.1]` cannot bypass the loopback block.
  const firstTenZero = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].every((i) => (bytes[i] ?? 0) === 0);
  if (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) {
    const v4 =
      (((bytes[12] ?? 0) << 24) |
        ((bytes[13] ?? 0) << 16) |
        ((bytes[14] ?? 0) << 8) |
        (bytes[15] ?? 0)) >>>
      0;
    if (isBlockedIpv4(v4)) return true;
  }

  return false;
}

interface HostClassification {
  readonly isIpLiteral: boolean;
  readonly blocked: boolean;
}

function classifyHost(hostname: string): HostClassification {
  // URL.hostname keeps the surrounding brackets for IPv6 literals.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const bytes = parseIpv6ToBytes(hostname.slice(1, -1));
    // An unparseable bracketed host is still an IP literal; block to be safe.
    if (bytes === null) return { isIpLiteral: true, blocked: true };
    return { isIpLiteral: true, blocked: isBlockedIpv6(bytes) };
  }

  const v4 = parseIpv4ToInt(hostname);
  if (v4 !== null) return { isIpLiteral: true, blocked: isBlockedIpv4(v4) };

  return { isIpLiteral: false, blocked: false };
}

/**
 * Decide whether an assembled URL is safe to fetch.
 *
 * Order of checks:
 *   1. Only `https:` is allowed.
 *   2. If the host is an IP literal in a private/loopback/link-local range it is
 *      rejected outright — even if it also appears in the allowlist.
 *   3. Otherwise the host must exactly match an allowlist entry.
 */
export function checkUrlSafety(url: URL, options: UrlSafetyOptions): UrlSafetyResult {
  if (url.protocol !== "https:") {
    return reject(`protocol not allowed: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();

  const { blocked } = classifyHost(hostname);
  if (blocked) {
    return reject(`blocked private/loopback/link-local address: ${hostname}`);
  }

  const inAllowlist = options.allowedHosts.some((host) => host.toLowerCase() === hostname);
  if (!inAllowlist) {
    return reject(`host not in allowlist: ${hostname}`);
  }

  return { allowed: true };
}
