import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeTextAtomically } from "@novel-studio/repository";

export const UNSIGNED_BETA_QUALIFICATION_VERSION = "1.0" as const;
export const UNSIGNED_BETA_CHANNEL = "unsigned-beta" as const;
const MAX_VALIDITY_MS = 24 * 60 * 60 * 1000;
const HASH = /^[a-f0-9]{64}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAIN_OWNED = new WeakSet<object>();
const REVOKED = new WeakSet<object>();

export interface UnsignedBetaAuthorizationV1 {
  readonly schemaVersion: typeof UNSIGNED_BETA_QUALIFICATION_VERSION;
  readonly channel: typeof UNSIGNED_BETA_CHANNEL;
  readonly packageIdentityChecksum: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly authorizationChecksum: string;
}

export interface UnsignedBetaAuthorizationService {
  /** Reads only the current process's Main-owned grant; disk is audit persistence, not authority. */
  read(): Promise<UnsignedBetaAuthorizationV1 | undefined>;
  requestAuthorization(
    confirm: () => Promise<boolean>
  ): Promise<UnsignedBetaAuthorizationV1 | undefined>;
  revoke(reason: string): Promise<void>;
  /** Main-only signal used to close active native sessions as soon as the grant is revoked. */
  subscribeRevocation(listener: () => void): () => void;
  readonly packageIdentityChecksum: string;
}

export function createUnsignedBetaPackageIdentityChecksum(input: {
  readonly appVersion: string;
  readonly appRoot: string;
}): string {
  return sha256(
    stableSerialize({
      channel: UNSIGNED_BETA_CHANNEL,
      appVersion: input.appVersion,
      appRoot: input.appRoot
    })
  );
}

export function createUnsignedBetaAuthorizationService(input: {
  readonly userDataRoot: string;
  readonly packageIdentityChecksum: string;
  readonly now?: () => string;
}): UnsignedBetaAuthorizationService {
  const path = join(input.userDataRoot, "agent-tool-settings", "unsigned-beta.json");
  const now = input.now ?? (() => new Date().toISOString());
  let revoked = false;
  let current: UnsignedBetaAuthorizationV1 | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const revocationListeners = new Set<() => void>();

  const revokeInMemory = (): void => {
    if (revoked) return;
    revoked = true;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    if (current !== undefined) REVOKED.add(current);
    current = undefined;
    for (const listener of revocationListeners) {
      try {
        listener();
      } catch {
        // Revocation remains authoritative even if a consumer's cleanup fails.
      }
    }
  };

  const scheduleExpiry = (authorization: UnsignedBetaAuthorizationV1): void => {
    const expire = (): void => {
      const observedAt = Date.parse(now());
      const expiresAt = Date.parse(authorization.expiresAt);
      if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || observedAt >= expiresAt) {
        revokeInMemory();
        return;
      }
      expiryTimer = setTimeout(expire, Math.min(expiresAt - observedAt, 2_147_483_647));
      expiryTimer.unref();
    };
    expire();
  };

  const read = async (): Promise<UnsignedBetaAuthorizationV1 | undefined> => {
    // A JSON file is advisory persistence only. It cannot grant Main authority after restart,
    // because a user or another process could edit it. The current process grant is Main-owned.
    if (revoked || current === undefined) return undefined;
    const value = current;
    const observedAt = Date.parse(now());
    if (
      value.packageIdentityChecksum !== input.packageIdentityChecksum ||
      value.revokedAt !== null ||
      !Number.isFinite(observedAt) ||
      observedAt < Date.parse(value.issuedAt) ||
      observedAt >= Date.parse(value.expiresAt)
    ) {
      revokeInMemory();
      return undefined;
    }
    return value;
  };

  return Object.freeze({
    packageIdentityChecksum: input.packageIdentityChecksum,
    read,
    async requestAuthorization(confirm: () => Promise<boolean>) {
      if (revoked) return undefined;
      if (!(await confirm())) return undefined;
      if (revoked) return undefined;
      const issuedAt = now();
      const issuedMs = Date.parse(issuedAt);
      if (!Number.isFinite(issuedMs) || !TIMESTAMP.test(issuedAt)) return undefined;
      const unsigned = {
        schemaVersion: UNSIGNED_BETA_QUALIFICATION_VERSION,
        channel: UNSIGNED_BETA_CHANNEL,
        packageIdentityChecksum: input.packageIdentityChecksum,
        issuedAt,
        expiresAt: new Date(issuedMs + MAX_VALIDITY_MS).toISOString(),
        revokedAt: null
      } as const;
      const value = Object.freeze({
        ...unsigned,
        authorizationChecksum: sha256(stableSerialize(unsigned))
      });
      await mkdir(dirname(path), { recursive: true });
      const written = await writeTextAtomically({
        targetPath: path,
        content: `${JSON.stringify(value, null, 2)}\n`,
        traceId: "desktop-unsigned-beta-authorization"
      });
      if (!written.ok || revoked) return undefined;
      MAIN_OWNED.add(value);
      current = value;
      scheduleExpiry(value);
      return value;
    },
    async revoke() {
      revokeInMemory();
      try {
        await writeTextAtomically({
          targetPath: path,
          content: '{\n  "revoked": true\n}\n',
          traceId: "desktop-unsigned-beta-authorization-revoke"
        });
      } catch {
        // In-memory revocation remains authoritative for this process.
      }
    },
    subscribeRevocation(listener: () => void) {
      revocationListeners.add(listener);
      if (revoked) listener();
      return () => revocationListeners.delete(listener);
    }
  });
}

export function hasCurrentUnsignedBetaAuthorization(
  value: unknown,
  packageIdentityChecksum: string,
  now: string = new Date().toISOString()
): value is UnsignedBetaAuthorizationV1 {
  if (
    value === null ||
    typeof value !== "object" ||
    !MAIN_OWNED.has(value) ||
    !validateUnsignedBetaAuthorization(value)
  ) {
    return false;
  }
  const authorization = value as UnsignedBetaAuthorizationV1;
  const observedAt = Date.parse(now);
  return (
    authorization.packageIdentityChecksum === packageIdentityChecksum &&
    !REVOKED.has(authorization) &&
    authorization.revokedAt === null &&
    Number.isFinite(observedAt) &&
    Date.parse(authorization.issuedAt) <= observedAt &&
    observedAt < Date.parse(authorization.expiresAt)
  );
}

export function validateUnsignedBetaAuthorization(
  value: unknown
): value is UnsignedBetaAuthorizationV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      [
        "authorizationChecksum",
        "channel",
        "expiresAt",
        "issuedAt",
        "packageIdentityChecksum",
        "revokedAt",
        "schemaVersion"
      ].join(",") ||
    record.schemaVersion !== UNSIGNED_BETA_QUALIFICATION_VERSION ||
    record.channel !== UNSIGNED_BETA_CHANNEL ||
    !HASH.test(String(record.packageIdentityChecksum)) ||
    !TIMESTAMP.test(String(record.issuedAt)) ||
    !TIMESTAMP.test(String(record.expiresAt)) ||
    (record.revokedAt !== null && !TIMESTAMP.test(String(record.revokedAt))) ||
    !HASH.test(String(record.authorizationChecksum))
  ) {
    return false;
  }
  const issued = Date.parse(record.issuedAt as string);
  const expires = Date.parse(record.expiresAt as string);
  if (
    !Number.isFinite(issued) ||
    !Number.isFinite(expires) ||
    expires <= issued ||
    expires - issued > MAX_VALIDITY_MS
  ) {
    return false;
  }
  const unsigned = { ...record };
  delete unsigned.authorizationChecksum;
  return record.authorizationChecksum === sha256(stableSerialize(unsigned));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
