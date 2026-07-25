/**
 * Main-owned network dialer for Agent tools.
 *
 * URL policy validation is shared with Application, but DNS resolution and the
 * actual socket connection live here. Every resolved candidate is checked, then
 * Node's lookup callback is pinned to an approved address so a later resolver
 * call cannot turn a validated hostname into a DNS-rebinding request.
 */
import { timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions as HttpRequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity as checkTlsServerIdentity } from "node:tls";

import {
  ControlledFetchError,
  NETWORK_CONNECT_TIMEOUT_MS,
  NETWORK_MAX_REDIRECTS,
  NETWORK_MAX_RESPONSE_BYTES,
  NETWORK_TOTAL_TIMEOUT_MS,
  isAllowedNetworkContentType,
  normalizeControlledFetchRequest,
  validateControlledFetchUrl,
  type AgentNetworkPolicy,
  type ControlledFetch,
  type ControlledFetchRequest,
  type ControlledFetchResponse,
  type NormalizedControlledFetchRequest
} from "@novel-studio/application";

export interface ResolvedNetworkAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** RFC 7050 DNS64 discovery material resolved beside one target hostname. */
export interface Rfc7050Nat64Discovery {
  /** All answers returned for ipv4only.arpa by the same Main-owned resolver boundary. */
  readonly ipv4onlyArpaAddresses: readonly ResolvedNetworkAddress[];
}

/**
 * A resolver snapshot keeps DNS64 discovery coupled to the addresses that will
 * be validated and pinned. The dialer never resolves the target hostname again.
 */
export interface NetworkAddressResolution {
  readonly addresses: readonly ResolvedNetworkAddress[];
  readonly nat64Discovery?: Rfc7050Nat64Discovery;
}

export type NetworkAddressResolver = (
  hostname: string
) => Promise<readonly ResolvedNetworkAddress[] | NetworkAddressResolution>;

export interface PinnedNetworkRequest {
  readonly url: URL;
  readonly address: ResolvedNetworkAddress;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly signal: AbortSignal;
  /** Normalized SHA-256 certificate fingerprint, when this route is pinned. */
  readonly tlsFingerprint?: string;
  /** Invoked by the actual TLS handshake before HTTP bytes are exchanged. */
  readonly verifyTlsPeer?: TlsPeerIdentityVerifier;
}

export interface PinnedNetworkResponse {
  readonly status: number;
  /** Header names must be lower-case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: AsyncIterable<Uint8Array> | null;
  /** Terminates an in-flight response body when a size/error boundary is hit. */
  readonly abort?: () => void;
}

export type PinnedNetworkDispatcher = (
  request: PinnedNetworkRequest
) => Promise<PinnedNetworkResponse>;

export interface TlsPeerCertificate {
  readonly fingerprint256?: string;
}

export type TlsPeerIdentityVerifier = (certificate: TlsPeerCertificate) => Error | undefined;

/** Credentials held only in Main and only usable against one exact HTTPS origin. */
export interface OriginScopedAuthorization {
  readonly origin: string;
  readonly authorization: string;
  /** Remote MCP uses this to fail closed on any redirect. */
  readonly rejectRedirects?: boolean;
}

export interface MainControlledFetchOptions {
  /** Injectable deterministic resolver for tests. Production uses node:dns.lookup(all). */
  readonly resolveHostname?: NetworkAddressResolver;
  /** Injectable transport for tests. Production uses node:http(s) with a pinned lookup callback. */
  readonly dispatch?: PinnedNetworkDispatcher;
  /** Internal Main-only credential binding, never supplied by the renderer or model. */
  readonly authorization?: OriginScopedAuthorization;
  /** SHA-256 certificate fingerprint checked on every HTTPS handshake. */
  readonly tlsFingerprint?: string;
  /** Reject the first redirect response instead of following it. */
  readonly rejectRedirects?: boolean;
}

const METADATA_IPV4 = new Set(["100.100.100.200", "168.63.129.16", "169.254.169.254"]);

interface MainControlledFetchSecurity {
  readonly tlsFingerprint?: string;
  readonly rejectRedirects: boolean;
}

const MAIN_CONTROLLED_FETCH_SECURITY = Symbol("main-controlled-fetch-security");

type MarkedControlledFetch = ControlledFetch & {
  readonly [MAIN_CONTROLLED_FETCH_SECURITY]?: MainControlledFetchSecurity;
};

/**
 * Proves that a fetcher was created by this Main-owned dialer with the supplied
 * transport controls. Opaque injected fetchers cannot make this assertion.
 */
export function hasMainControlledFetchSecurity(
  fetch_: ControlledFetch,
  requirements: Readonly<{ readonly tlsFingerprint?: string; readonly rejectRedirects?: boolean }>
): boolean {
  const security = (fetch_ as MarkedControlledFetch)[MAIN_CONTROLLED_FETCH_SECURITY];
  if (security === undefined) return false;
  if (requirements.rejectRedirects === true && !security.rejectRedirects) return false;
  return (
    requirements.tlsFingerprint === undefined ||
    security.tlsFingerprint === requirements.tlsFingerprint
  );
}

/** Accept conventional colon-delimited or compact SHA-256 certificate fingerprints. */
export function normalizeTlsFingerprint(fingerprint: string): string | undefined {
  const value = fingerprint.trim().replace(/^sha256:/i, "");
  const compact = value.replace(/:/g, "");
  const compactSha256 = /^[0-9a-fA-F]{64}$/;
  const colonDelimitedSha256 = /^(?:[0-9a-fA-F]{2}:){31}[0-9a-fA-F]{2}$/;
  if (
    !compactSha256.test(compact) ||
    !(compactSha256.test(value) || colonDelimitedSha256.test(value))
  ) {
    return undefined;
  }
  return compact.toLowerCase();
}

/**
 * The verifier is carried through each pinned request and is invoked from the
 * HTTPS socket's `checkServerIdentity` callback, not as a preflight probe.
 */
export function createTlsPeerIdentityVerifier(
  expectedFingerprint: string
): TlsPeerIdentityVerifier {
  const expected = normalizeTlsFingerprint(expectedFingerprint);
  if (expected === undefined) {
    throw new ControlledFetchError(
      "NETWORK_TLS_FINGERPRINT_INVALID",
      "TLS certificate fingerprint must be a SHA-256 fingerprint."
    );
  }
  const expectedBytes = Buffer.from(expected, "hex");
  return (certificate) => {
    const actual =
      certificate.fingerprint256 === undefined
        ? undefined
        : normalizeTlsFingerprint(certificate.fingerprint256);
    if (actual === undefined) {
      return new Error("Pinned TLS certificate did not provide a SHA-256 fingerprint.");
    }
    const actualBytes = Buffer.from(actual, "hex");
    if (
      actualBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      return new Error("Pinned TLS certificate fingerprint did not match.");
    }
    return undefined;
  };
}

/**
 * Reject all non-public or metadata address candidates. A single unsafe A or
 * AAAA answer rejects the hostname rather than selecting a convenient answer;
 * otherwise a resolver/Happy-Eyeballs change could bypass validation.
 */
export function isBlockedNetworkAddress(address: string): boolean {
  return isBlockedNetworkAddressWithNat64Prefixes(address, RFC6052_NAT64_PREFIXES);
}

function isBlockedNetworkAddressWithNat64Prefixes(
  address: string,
  nat64Prefixes: readonly Rfc6052Nat64Prefix[]
): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address, nat64Prefixes);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  if (METADATA_IPV4.has(address)) return true;
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // shared address space
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6(address: string, nat64Prefixes: readonly Rfc6052Nat64Prefix[]): boolean {
  const bytes = parseIpv6Bytes(address);
  if (bytes === undefined) return true;
  if (bytes.every((byte) => byte === 0)) return true; // ::
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true; // ::1

  const firstHighByte = bytes[0];
  const firstLowByte = bytes[1];
  if (firstHighByte === undefined || firstLowByte === undefined) return true;
  const first = (firstHighByte << 8) | firstLowByte;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((first & 0xff00) === 0xff00) return true; // multicast

  // Several IPv6 transition formats encode an IPv4 endpoint in non-obvious
  // byte positions. Classify their decoded IPv4 target with the same SSRF
  // rules so expanded hexadecimal forms cannot evade private/metadata checks.
  const embeddedIpv4Targets = embeddedIpv4TargetsFromIpv6(bytes, nat64Prefixes);
  return embeddedIpv4Targets.some((target) => isBlockedIpv4(target));
}

function parseIpv6Bytes(address: string): Uint8Array | undefined {
  const normalized = address.toLowerCase();
  if (normalized.includes("%")) return undefined;
  const compressionIndex = normalized.indexOf("::");
  if (compressionIndex !== -1 && normalized.indexOf("::", compressionIndex + 2) !== -1) {
    return undefined;
  }

  const head = compressionIndex === -1 ? normalized : normalized.slice(0, compressionIndex);
  const tail = compressionIndex === -1 ? "" : normalized.slice(compressionIndex + 2);
  const headWords = parseIpv6Words(head);
  const tailWords = parseIpv6Words(tail);
  if (headWords === undefined || tailWords === undefined) return undefined;

  const suppliedWords = headWords.length + tailWords.length;
  if (
    (compressionIndex === -1 && suppliedWords !== 8) ||
    (compressionIndex !== -1 && suppliedWords >= 8)
  ) {
    return undefined;
  }
  const words =
    compressionIndex === -1
      ? headWords
      : [...headWords, ...Array<number>(8 - suppliedWords).fill(0), ...tailWords];
  const bytes = new Uint8Array(16);
  for (const [index, word] of words.entries()) {
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  }
  return bytes;
}

function parseIpv6Words(segment: string): number[] | undefined {
  if (segment === "") return [];
  const parts = segment.split(":");
  const words: number[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.includes(".")) {
      if (index !== parts.length - 1) return undefined;
      const octets = parseIpv4Octets(part);
      if (octets === undefined) return undefined;
      words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
    words.push(Number.parseInt(part, 16));
  }
  return words;
}

function parseIpv4Octets(address: string): readonly [number, number, number, number] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (
    parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part)) ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined;
  }
  return octets as [number, number, number, number];
}

function embeddedIpv4TargetsFromIpv6(
  bytes: Uint8Array,
  nat64Prefixes: readonly Rfc6052Nat64Prefix[]
): readonly string[] {
  // IPv4-compatible (::/96), IPv4-mapped (::ffff:0:0/96), and the RFC 6145
  // translated form (::ffff:0:0:0/96) each place IPv4 in the final 32 bits.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return [ipv4FromBytes(bytes, 12)];
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return [ipv4FromBytes(bytes, 12)];
  }
  if (
    bytes.slice(0, 8).every((byte) => byte === 0) &&
    bytes[8] === 0xff &&
    bytes[9] === 0xff &&
    bytes[10] === 0 &&
    bytes[11] === 0
  ) {
    return [ipv4FromBytes(bytes, 12)];
  }

  for (const prefix of nat64Prefixes) {
    if (isRfc6052EmbeddedIpv4Address(bytes, prefix)) {
      return [extractRfc6052Ipv4(bytes, prefix.length)];
    }
  }

  // 6to4 carries its IPv4 gateway address directly after the 2002::/16
  // prefix. Teredo carries both a server IPv4 address and a one's-complement
  // client IPv4 address; either can point at a blocked destination.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return [ipv4FromBytes(bytes, 2)];
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) {
    return [ipv4FromBytes(bytes, 4), ipv4FromBytes(bytes, 12, true)];
  }
  return [];
}

type Rfc6052PrefixLength = 32 | 40 | 48 | 56 | 64 | 96;

interface Rfc6052Nat64Prefix {
  readonly bytes: Uint8Array;
  readonly length: Rfc6052PrefixLength;
}

const RFC6052_PREFIX_LENGTHS: readonly Rfc6052PrefixLength[] = [32, 40, 48, 56, 64, 96];

const RFC6052_NAT64_PREFIXES: readonly Rfc6052Nat64Prefix[] = [
  {
    // 64:ff9b::/96 (RFC 6052 well-known prefix)
    bytes: Uint8Array.from([0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    length: 96
  },
  {
    // 64:ff9b:1::/48 (RFC 8215 local-use prefix)
    bytes: Uint8Array.from([0x00, 0x64, 0xff, 0x9b, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    length: 48
  }
];

const RFC7050_IPV4_ONLY_HOSTNAME = "ipv4only.arpa";
const RFC7050_IPV4_ONLY_TARGETS = ["192.0.0.170", "192.0.0.171"] as const;

function matchesIpv6Prefix(bytes: Uint8Array, prefix: Uint8Array, length: number): boolean {
  const completeBytes = Math.floor(length / 8);
  for (let index = 0; index < completeBytes; index += 1) {
    const byte = bytes[index];
    const prefixByte = prefix[index];
    if (byte === undefined || prefixByte === undefined || byte !== prefixByte) return false;
  }
  const remainingBits = length % 8;
  if (remainingBits === 0) return true;
  const byte = bytes[completeBytes];
  const prefixByte = prefix[completeBytes];
  if (byte === undefined || prefixByte === undefined) return false;
  const mask = 0xff << (8 - remainingBits);
  return (byte & mask) === (prefixByte & mask);
}

function isRfc6052EmbeddedIpv4Address(bytes: Uint8Array, prefix: Rfc6052Nat64Prefix): boolean {
  if (!matchesIpv6Prefix(bytes, prefix.bytes, prefix.length)) return false;
  const embedded = extractRfc6052Ipv4(bytes, prefix.length);
  return equalIpv6Bytes(bytes, encodeRfc6052Ipv4(prefix, embedded));
}

function extractRfc6052Ipv4(bytes: Uint8Array, prefixLength: Rfc6052PrefixLength): string {
  switch (prefixLength) {
    case 32:
      return ipv4FromByteIndexes(bytes, [4, 5, 6, 7]);
    case 40:
      return ipv4FromByteIndexes(bytes, [5, 6, 7, 9]);
    case 48:
      return ipv4FromByteIndexes(bytes, [6, 7, 9, 10]);
    case 56:
      return ipv4FromByteIndexes(bytes, [7, 9, 10, 11]);
    case 64:
      return ipv4FromByteIndexes(bytes, [9, 10, 11, 12]);
    case 96:
      return ipv4FromBytes(bytes, 12);
  }
}

function encodeRfc6052Ipv4(prefix: Rfc6052Nat64Prefix, ipv4: string): Uint8Array {
  const octets = parseIpv4Octets(ipv4);
  if (octets === undefined) throw new Error("RFC 6052 encoding requires an IPv4 address.");

  const bytes = new Uint8Array(16);
  const prefixBytes = prefix.length / 8;
  bytes.set(prefix.bytes.slice(0, prefixBytes));
  switch (prefix.length) {
    case 32:
      bytes.set(octets, 4);
      break;
    case 40:
      bytes.set(octets.slice(0, 3), 5);
      bytes[9] = octets[3];
      break;
    case 48:
      bytes.set(octets.slice(0, 2), 6);
      bytes.set(octets.slice(2), 9);
      break;
    case 56:
      bytes[7] = octets[0];
      bytes.set(octets.slice(1), 9);
      break;
    case 64:
      bytes.set(octets, 9);
      break;
    case 96:
      bytes.set(octets, 12);
      break;
  }
  return bytes;
}

function ipv4FromByteIndexes(
  bytes: Uint8Array,
  indexes: readonly [number, number, number, number]
): string {
  return indexes.map((index) => bytes[index]).join(".");
}

function equalIpv6Bytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function rfc6052PrefixFromAddress(
  bytes: Uint8Array,
  length: Rfc6052PrefixLength
): Rfc6052Nat64Prefix {
  const prefix = new Uint8Array(16);
  prefix.set(bytes.slice(0, length / 8));
  return { bytes: prefix, length };
}

function ipv4FromBytes(bytes: Uint8Array, offset: number, invert = false): string {
  return Array.from(bytes.slice(offset, offset + 4), (byte) => (invert ? byte ^ 0xff : byte)).join(
    "."
  );
}

async function defaultResolveHostname(hostname: string): Promise<NetworkAddressResolution> {
  // Resolve the target exactly once and retain that answer for socket pinning.
  // The only companion query is RFC 7050's fixed sentinel; it cannot change
  // the target hostname or introduce a second target resolution.
  const [targetResult, discoveryResult] = await Promise.allSettled([
    resolveNodeAddresses(hostname),
    resolveNodeAddresses(RFC7050_IPV4_ONLY_HOSTNAME)
  ]);
  if (targetResult.status === "rejected") throw targetResult.reason;

  return {
    addresses: targetResult.value,
    nat64Discovery: {
      // ENODATA/ENOTFOUND from this same OS resolver explicitly establishes
      // that it cannot synthesize the RFC 7050 sentinel. Other probe failures
      // remain invalid and cannot authorize IPv6-only delivery.
      ipv4onlyArpaAddresses:
        discoveryResult.status === "fulfilled"
          ? discoveryResult.value
          : isExplicitNoDns64DiscoveryError(discoveryResult.reason)
            ? rfc7050Ipv4OnlyAnswers()
            : []
    }
  };
}

async function resolveNodeAddresses(hostname: string): Promise<readonly ResolvedNetworkAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry) => {
    if (entry.family !== 4 && entry.family !== 6) return [];
    return [{ address: entry.address, family: entry.family }];
  });
}

function isExplicitNoDns64DiscoveryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENODATA" || error.code === "ENOTFOUND")
  );
}

function rfc7050Ipv4OnlyAnswers(): readonly ResolvedNetworkAddress[] {
  return RFC7050_IPV4_ONLY_TARGETS.map((address) => ({ address, family: 4 }));
}

function validateResolvedAddresses(
  hostname: string,
  result: readonly ResolvedNetworkAddress[] | NetworkAddressResolution
): readonly ResolvedNetworkAddress[] {
  const resolution = normalizeNetworkAddressResolution(result);
  const addresses = resolution.addresses;
  if (addresses.length === 0) {
    throw new ControlledFetchError(
      "NETWORK_DNS_EMPTY",
      `Host '${hostname}' returned no DNS addresses.`
    );
  }

  for (const address of addresses) {
    if (isIP(address.address) !== address.family) {
      throw new ControlledFetchError(
        "NETWORK_DNS_SSRF_REJECTED",
        `Host '${hostname}' resolved to a blocked address.`
      );
    }
    if (address.family === 4 && isBlockedIpv4(address.address)) {
      throw new ControlledFetchError(
        "NETWORK_DNS_SSRF_REJECTED",
        `Host '${hostname}' resolved to a blocked address.`
      );
    }
  }

  const nat64Discovery = inspectRfc7050Nat64Discovery(resolution.nat64Discovery);
  const publicIpv4 = addresses.filter((address) => address.family === 4);
  if (publicIpv4.length > 0) return publicIpv4;

  if (nat64Discovery.kind === "prefix") {
    const publicNat64Ipv6 = addresses.filter((address) => {
      if (address.family !== 6) return false;
      const bytes = parseIpv6Bytes(address.address);
      return (
        bytes !== undefined &&
        isRfc6052EmbeddedIpv4Address(bytes, nat64Discovery.prefix) &&
        !isBlockedNetworkAddressWithNat64Prefixes(address.address, [nat64Discovery.prefix])
      );
    });
    if (publicNat64Ipv6.length > 0) return publicNat64Ipv6;
    throw new ControlledFetchError(
      "NETWORK_DNS_SSRF_REJECTED",
      `Host '${hostname}' resolved to a blocked NAT64 address.`
    );
  }

  if (addresses.some((address) => address.family === 6)) {
    throw new ControlledFetchError(
      "NETWORK_DNS_NAT64_DISCOVERY_REJECTED",
      "No verified public IPv4 address is available for this IPv6 candidate."
    );
  }
  throw new ControlledFetchError(
    "NETWORK_DNS_EMPTY",
    `Host '${hostname}' returned no usable address.`
  );
}

function normalizeNetworkAddressResolution(
  result: readonly ResolvedNetworkAddress[] | NetworkAddressResolution
): NetworkAddressResolution {
  if (Array.isArray(result)) return { addresses: result };
  return result as NetworkAddressResolution;
}

type Rfc7050Nat64DiscoveryState =
  | { readonly kind: "none" }
  | { readonly kind: "prefix"; readonly prefix: Rfc6052Nat64Prefix }
  | { readonly kind: "unavailable" }
  | { readonly kind: "invalid" };

function inspectRfc7050Nat64Discovery(
  discovery: Rfc7050Nat64Discovery | undefined
): Rfc7050Nat64DiscoveryState {
  if (discovery === undefined) return { kind: "unavailable" };
  const answers = discovery.ipv4onlyArpaAddresses;
  if (!Array.isArray(answers)) return { kind: "invalid" };

  const ipv4Answers = new Set<string>();
  const ipv6Answers = new Map<string, Uint8Array>();
  for (const answer of answers) {
    if (isIP(answer.address) !== answer.family) return { kind: "invalid" };
    if (answer.family === 4) {
      const normalized = parseIpv4Octets(answer.address)?.join(".");
      if (
        normalized === undefined ||
        !RFC7050_IPV4_ONLY_TARGETS.some((target) => target === normalized)
      ) {
        return { kind: "invalid" };
      }
      ipv4Answers.add(normalized);
      continue;
    }
    const bytes = parseIpv6Bytes(answer.address);
    if (bytes === undefined) return { kind: "invalid" };
    ipv6Answers.set(Array.from(bytes).join("."), bytes);
  }

  // A resolver without DNS64 must return the two IANA A records. Anything
  // else is ambiguous and therefore cannot authorize an IPv6 target.
  if (ipv6Answers.size === 0) {
    return ipv4Answers.size === RFC7050_IPV4_ONLY_TARGETS.length
      ? { kind: "none" }
      : { kind: "invalid" };
  }
  if (ipv4Answers.size !== RFC7050_IPV4_ONLY_TARGETS.length) return { kind: "invalid" };

  const candidates = new Map<string, Rfc6052Nat64Prefix>();
  for (const bytes of ipv6Answers.values()) {
    for (const length of RFC6052_PREFIX_LENGTHS) {
      const prefix = rfc6052PrefixFromAddress(bytes, length);
      if (
        RFC7050_IPV4_ONLY_TARGETS.some((target) =>
          equalIpv6Bytes(bytes, encodeRfc6052Ipv4(prefix, target))
        )
      ) {
        candidates.set(rfc6052PrefixKey(prefix), prefix);
      }
    }
  }

  const verified = Array.from(candidates.values()).filter((prefix) => {
    const expected = new Set(
      RFC7050_IPV4_ONLY_TARGETS.map((target) =>
        Array.from(encodeRfc6052Ipv4(prefix, target)).join(".")
      )
    );
    return (
      expected.size === ipv6Answers.size &&
      Array.from(ipv6Answers.keys()).every((address) => expected.has(address))
    );
  });
  const prefix = verified[0];
  return verified.length === 1 && prefix !== undefined
    ? { kind: "prefix", prefix }
    : { kind: "invalid" };
}

function rfc6052PrefixKey(prefix: Rfc6052Nat64Prefix): string {
  return `${prefix.length}:${Array.from(prefix.bytes.slice(0, prefix.length / 8)).join(".")}`;
}

/**
 * Production controlled fetch. It resolves all candidates once per hop, checks
 * every candidate, and routes the socket through an immutable approved address.
 */
export function createMainControlledFetch(
  policy: AgentNetworkPolicy,
  options: MainControlledFetchOptions = {}
): ControlledFetch {
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const dispatch = options.dispatch ?? dispatchPinnedRequest;
  const authorization = validateAuthorizationScope(options.authorization);
  const tlsFingerprint =
    options.tlsFingerprint === undefined
      ? undefined
      : normalizeTlsFingerprint(options.tlsFingerprint);
  if (options.tlsFingerprint !== undefined && tlsFingerprint === undefined) {
    throw new ControlledFetchError(
      "NETWORK_TLS_FINGERPRINT_INVALID",
      "TLS certificate fingerprint must be a SHA-256 fingerprint."
    );
  }
  const verifyTlsPeer =
    tlsFingerprint === undefined ? undefined : createTlsPeerIdentityVerifier(tlsFingerprint);
  const rejectRedirects =
    options.rejectRedirects === true || authorization?.rejectRedirects === true;

  const mainControlledFetch: ControlledFetch = async function mainControlledFetch(
    request: ControlledFetchRequest
  ): Promise<ControlledFetchResponse> {
    const url = validateControlledFetchUrl(policy, request.url);
    const normalized = normalizeControlledFetchRequest(request, url);
    assertCredentialScope(normalized.url, authorization);

    const totalController = new AbortController();
    const totalTimeoutId = setTimeout(
      () => totalController.abort(new Error("NETWORK_TOTAL_TIMEOUT")),
      NETWORK_TOTAL_TIMEOUT_MS
    );
    const combinedSignal = request.signal
      ? combineAbortSignals([request.signal, totalController.signal])
      : undefined;
    const signal = combinedSignal?.signal ?? totalController.signal;

    try {
      return await fetchPinnedWithRedirectLimit(
        normalized,
        signal,
        policy,
        resolveHostname,
        dispatch,
        authorization,
        tlsFingerprint,
        verifyTlsPeer,
        rejectRedirects,
        NETWORK_MAX_REDIRECTS
      );
    } finally {
      clearTimeout(totalTimeoutId);
      totalController.abort();
      combinedSignal?.dispose();
    }
  };
  const security: MainControlledFetchSecurity = {
    rejectRedirects,
    ...(tlsFingerprint === undefined ? {} : { tlsFingerprint })
  };
  Object.defineProperty(mainControlledFetch, MAIN_CONTROLLED_FETCH_SECURITY, {
    value: security,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return mainControlledFetch;
}

/**
 * Create a Main-only credential-bound fetcher. The secret is never accepted in
 * ControlledFetchRequest, so generic `fetch_url` calls cannot inherit it.
 */
export function createOriginScopedControlledFetch(
  policy: AgentNetworkPolicy,
  authorization: OriginScopedAuthorization,
  options: Omit<MainControlledFetchOptions, "authorization"> = {}
): ControlledFetch {
  return createMainControlledFetch(policy, { ...options, authorization });
}

function validateAuthorizationScope(
  scope: OriginScopedAuthorization | undefined
): OriginScopedAuthorization | undefined {
  if (scope === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(scope.origin);
  } catch {
    throw new ControlledFetchError(
      "NETWORK_CREDENTIAL_SCOPE_INVALID",
      "Credential scope has an invalid origin."
    );
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ControlledFetchError(
      "NETWORK_CREDENTIAL_SCOPE_INVALID",
      "Credentials may only be bound to one exact HTTPS origin."
    );
  }
  if (scope.authorization.length === 0 || /[\r\n]/.test(scope.authorization)) {
    throw new ControlledFetchError(
      "NETWORK_CREDENTIAL_SCOPE_INVALID",
      "Credential value is invalid."
    );
  }
  return {
    origin: parsed.origin,
    authorization: scope.authorization,
    ...(scope.rejectRedirects === undefined ? {} : { rejectRedirects: scope.rejectRedirects })
  };
}

function assertCredentialScope(url: URL, scope: OriginScopedAuthorization | undefined): void {
  if (scope !== undefined && url.origin !== scope.origin) {
    throw new ControlledFetchError(
      "NETWORK_CREDENTIAL_ORIGIN_MISMATCH",
      "Credential-bound requests cannot change origin, port, or protocol."
    );
  }
}

async function fetchPinnedWithRedirectLimit(
  request: NormalizedControlledFetchRequest,
  signal: AbortSignal,
  policy: AgentNetworkPolicy,
  resolveHostname: NetworkAddressResolver,
  dispatch: PinnedNetworkDispatcher,
  authorization: OriginScopedAuthorization | undefined,
  tlsFingerprint: string | undefined,
  verifyTlsPeer: TlsPeerIdentityVerifier | undefined,
  rejectRedirects: boolean,
  redirectsLeft: number
): Promise<ControlledFetchResponse> {
  const addresses = validateResolvedAddresses(
    request.url.hostname,
    await resolveHostname(request.url.hostname)
  );
  // Pick a single validated address. We do not retry another family/address on
  // connection failure because a retry would create a new delivery attempt.
  const address = addresses[0];
  if (address === undefined) {
    throw new ControlledFetchError("NETWORK_DNS_EMPTY", "Host returned no usable DNS addresses.");
  }

  const dispatched = await dispatchWithConnectTimeout(
    {
      url: request.url,
      address,
      method: request.method,
      headers: buildOutboundHeaders(request, authorization),
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(tlsFingerprint === undefined ? {} : { tlsFingerprint }),
      ...(verifyTlsPeer === undefined ? {} : { verifyTlsPeer }),
      signal
    },
    dispatch
  );
  const response = dispatched.response;

  try {
    if (response.status >= 300 && response.status < 400) {
      response.abort?.();
      if (rejectRedirects) {
        throw new ControlledFetchError(
          "NETWORK_REDIRECT_REJECTED",
          "This endpoint does not permit redirects."
        );
      }
      if (redirectsLeft <= 0) {
        throw new ControlledFetchError(
          "NETWORK_TOO_MANY_REDIRECTS",
          "Exceeded maximum redirect limit."
        );
      }
      const location = response.headers["location"];
      if (location === undefined || location.length === 0) {
        throw new ControlledFetchError("NETWORK_REDIRECT_NO_LOCATION", "Redirect had no Location.");
      }
      const redirected = new URL(location, request.url);
      if (request.url.protocol === "https:" && redirected.protocol === "http:") {
        throw new ControlledFetchError(
          "NETWORK_HTTPS_DOWNGRADE_REJECTED",
          "HTTPS redirects cannot downgrade to HTTP."
        );
      }
      let redirectedUrl: URL;
      try {
        redirectedUrl = validateControlledFetchUrl(policy, redirected.toString());
        assertCredentialScope(redirectedUrl, authorization);
      } catch (error) {
        if (error instanceof ControlledFetchError) {
          throw new ControlledFetchError(redirectValidationErrorCode(error.code), error.message);
        }
        throw error;
      }
      const nextRequest = redirectRequestForResponse(request, redirectedUrl, response.status);
      return fetchPinnedWithRedirectLimit(
        nextRequest,
        signal,
        policy,
        resolveHostname,
        dispatch,
        authorization,
        tlsFingerprint,
        verifyTlsPeer,
        rejectRedirects,
        redirectsLeft - 1
      );
    }

    const contentType = response.headers["content-type"] ?? null;
    if (!isAllowedNetworkContentType(contentType)) {
      response.abort?.();
      throw new ControlledFetchError(
        "NETWORK_CONTENT_TYPE_REJECTED",
        `Content-Type '${contentType}' is not permitted.`
      );
    }
    const contentEncoding = response.headers["content-encoding"]?.trim().toLowerCase();
    if (contentEncoding !== undefined && contentEncoding !== "" && contentEncoding !== "identity") {
      response.abort?.();
      throw new ControlledFetchError(
        "NETWORK_CONTENT_ENCODING_REJECTED",
        "Compressed responses are not accepted by the controlled dialer."
      );
    }
    const contentLength = response.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) > NETWORK_MAX_RESPONSE_BYTES) {
      response.abort?.();
      throw new ControlledFetchError(
        "NETWORK_RESPONSE_TOO_LARGE",
        `Response exceeds ${NETWORK_MAX_RESPONSE_BYTES} bytes.`
      );
    }

    const { body, truncated } = await readBoundedBody(response, signal);
    return {
      url: request.url.toString(),
      status: response.status,
      contentType,
      body,
      truncated,
      headers: response.headers
    };
  } finally {
    dispatched.dispose();
  }
}

function redirectValidationErrorCode(code: string): string {
  if (code === "NETWORK_HOST_NOT_ALLOWED") return "NETWORK_REDIRECT_HOST_NOT_ALLOWED";
  if (code === "NETWORK_SSRF_REJECTED") return "NETWORK_SSRF_REDIRECT";
  if (code === "NETWORK_SCHEME_REJECTED") return "NETWORK_REDIRECT_SCHEME";
  if (code === "NETWORK_PORT_NOT_ALLOWED") return "NETWORK_REDIRECT_PORT_NOT_ALLOWED";
  return `NETWORK_REDIRECT_${code}`;
}

function buildOutboundHeaders(
  request: NormalizedControlledFetchRequest,
  authorization: OriginScopedAuthorization | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": "NovelStudio-Agent/1.0 (pinned-dialer)",
    accept: "text/html,text/plain,application/json,text/markdown",
    "accept-encoding": "identity",
    // Force the original authority rather than the pinned IP. This retains the
    // correct HTTP Host value while `lookup` controls the actual socket peer.
    host: request.url.host,
    ...request.headers
  };
  if (authorization !== undefined) headers["authorization"] = authorization.authorization;
  if (request.body !== undefined) headers["content-length"] = String(bodyByteLength(request.body));
  return headers;
}

function bodyByteLength(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
}

async function dispatchWithConnectTimeout(
  request: PinnedNetworkRequest,
  dispatch: PinnedNetworkDispatcher
): Promise<{ readonly response: PinnedNetworkResponse; readonly dispose: () => void }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error("NETWORK_CONNECT_TIMEOUT")),
    NETWORK_CONNECT_TIMEOUT_MS
  );
  const combinedSignal = combineAbortSignals([request.signal, controller.signal]);
  let responseReceived = false;
  try {
    const response = await dispatch({ ...request, signal: combinedSignal.signal });
    responseReceived = true;
    return { response, dispose: combinedSignal.dispose };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ControlledFetchError("NETWORK_CONNECT_TIMEOUT", "Connection timed out.");
    }
    throw asControlledAbortError(error, combinedSignal.signal);
  } finally {
    clearTimeout(timeoutId);
    if (!responseReceived) {
      controller.abort();
      combinedSignal.dispose();
    }
  }
}

function redirectRequestForResponse(
  request: NormalizedControlledFetchRequest,
  redirectedUrl: URL,
  status: number
): NormalizedControlledFetchRequest {
  if (request.url.origin !== redirectedUrl.origin && request.body !== undefined) {
    throw new ControlledFetchError(
      "NETWORK_REDIRECT_BODY_CROSS_ORIGIN",
      "A request body cannot be forwarded to a different origin."
    );
  }
  if (request.method === "POST" && (status === 301 || status === 302 || status === 303)) {
    const headers = { ...request.headers };
    delete headers["content-type"];
    return { url: redirectedUrl, method: "GET", headers };
  }
  return { ...request, url: redirectedUrl };
}

async function readBoundedBody(
  response: PinnedNetworkResponse,
  signal: AbortSignal
): Promise<{ readonly body: string; readonly truncated: boolean }> {
  if (response.body === null) return { body: "", truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of response.body) {
      if (signal.aborted) throw asControlledAbortError(undefined, signal);
      const remaining = NETWORK_MAX_RESPONSE_BYTES - total;
      if (chunk.byteLength >= remaining) {
        chunks.push(chunk.slice(0, remaining));
        total += remaining;
        truncated = true;
        response.abort?.();
        break;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } catch (error) {
    if (signal.aborted) throw asControlledAbortError(error, signal);
    throw error;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder("utf-8", { fatal: false }).decode(bytes), truncated };
}

function asControlledAbortError(
  error: unknown,
  signal: AbortSignal
): ControlledFetchError | unknown {
  if (!signal.aborted) return error;
  return controlledAbortError(signal);
}

function controlledAbortError(signal: AbortSignal): ControlledFetchError {
  const message =
    signal.reason instanceof Error ? signal.reason.message : String(signal.reason ?? "");
  if (message === "NETWORK_TOTAL_TIMEOUT") {
    return new ControlledFetchError("NETWORK_TOTAL_TIMEOUT", "Network request timed out.");
  }
  if (message === "NETWORK_CONNECT_TIMEOUT") {
    return new ControlledFetchError("NETWORK_CONNECT_TIMEOUT", "Connection timed out.");
  }
  return new ControlledFetchError("NETWORK_ABORTED", "Network request was aborted.");
}

interface CombinedAbortSignal {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}

function combineAbortSignals(signals: readonly AbortSignal[]): CombinedAbortSignal {
  const controller = new AbortController();
  const listeners: Array<readonly [AbortSignal, () => void]> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = (): void => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    listeners.push([signal, onAbort]);
  }
  let disposed = false;
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
      listeners.length = 0;
    }
  };
}

async function dispatchPinnedRequest(
  request: PinnedNetworkRequest
): Promise<PinnedNetworkResponse> {
  return new Promise<PinnedNetworkResponse>((resolve, reject) => {
    if (request.signal.aborted) {
      reject(asControlledAbortError(undefined, request.signal));
      return;
    }

    const common: HttpRequestOptions = {
      protocol: request.url.protocol,
      hostname: request.url.hostname,
      ...(request.url.port === "" ? {} : { port: Number(request.url.port) }),
      path: `${request.url.pathname}${request.url.search}`,
      method: request.method,
      headers: request.headers,
      // Do not use Node's global agent. In particular, do not inherit a proxy
      // dispatcher or an environment-derived connection policy.
      agent: false,
      lookup: (hostname, _options, callback) => {
        if (hostname !== request.url.hostname) {
          callback(new Error("Pinned lookup hostname mismatch"), "", request.address.family);
          return;
        }
        callback(null, request.address.address, request.address.family);
      }
    };
    const options: HttpRequestOptions | HttpsRequestOptions =
      request.url.protocol === "https:"
        ? {
            ...common,
            servername: request.url.hostname,
            rejectUnauthorized: true,
            ...(request.verifyTlsPeer === undefined
              ? {}
              : {
                  checkServerIdentity: (hostname, certificate) => {
                    const hostnameError = checkTlsServerIdentity(hostname, certificate);
                    if (hostnameError !== undefined) return hostnameError;
                    return request.verifyTlsPeer?.(certificate);
                  }
                })
          }
        : common;
    const clientRequest =
      request.url.protocol === "https:"
        ? httpsRequest(options as HttpsRequestOptions)
        : httpRequest(options as HttpRequestOptions);

    const abort = (): void => {
      clientRequest.destroy(controlledAbortError(request.signal));
    };
    request.signal.addEventListener("abort", abort, { once: true });
    clientRequest.once("error", (error) => {
      request.signal.removeEventListener("abort", abort);
      reject(asControlledAbortError(error, request.signal));
    });
    clientRequest.once("response", (response) => {
      request.signal.removeEventListener("abort", abort);
      const abortResponse = (): void => {
        response.destroy(controlledAbortError(request.signal));
      };
      // Keep the total/user abort signal attached after response headers arrive;
      // otherwise a stalled body could outlive the total timeout.
      request.signal.addEventListener("abort", abortResponse, { once: true });
      resolve({
        status: response.statusCode ?? 0,
        headers: flattenHeaders(response.headers),
        body: response as unknown as AsyncIterable<Uint8Array>,
        abort: () => {
          request.signal.removeEventListener("abort", abortResponse);
          response.destroy();
        }
      });
    });
    clientRequest.end(request.body);
  });
}

function flattenHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return result;
}
