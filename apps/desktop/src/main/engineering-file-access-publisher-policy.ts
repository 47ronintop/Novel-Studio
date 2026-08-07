import { createHash } from "node:crypto";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

/**
 * The signer policy is Main-owned source, rather than build, project, IPC, or
 * environment configuration. Adding a production publisher is a reviewed
 * source change because this policy is part of the production trust boundary.
 */
export interface EngineeringFileAccessPublisherPolicyV1 {
  readonly schemaVersion: "1.0";
  readonly policyId: "novel_studio_engineering_file_access_publishers";
  readonly revision: string;
  /** SHA-256 digests of the DER leaf certificates accepted for the addon. */
  readonly authenticodeSignerCertificateSha256: readonly string[];
  /** SHA-256 digests of the DER leaf certificates accepted for the CMS manifest. */
  readonly detachedCmsSignerCertificateSha256: readonly string[];
}

export interface EngineeringFileAccessObservedPublishersV1 {
  readonly authenticodeSignerCertificateSha256: string;
  readonly detachedCmsSignerCertificateSha256: string;
}

/**
 * Empty is intentional until the release owner provides production signer
 * certificate fingerprints in a separately reviewed source change. An empty
 * policy is not a wildcard: production qualification must remain unavailable.
 */
export const ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY: EngineeringFileAccessPublisherPolicyV1 =
  deepFreeze({
    schemaVersion: "1.0" as const,
    policyId: "novel_studio_engineering_file_access_publishers" as const,
    revision: "unconfigured-r1",
    authenticodeSignerCertificateSha256: [],
    detachedCmsSignerCertificateSha256: []
  });

/** SHA-256 of canonical policy JSON, for manifest/probe binding. */
export const ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM = sha256(
  canonicalJson(ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY)
);

/**
 * A production release needs independently pinned owners for both signatures.
 * This prevents a valid but unreviewed system-trusted publisher from becoming
 * an authority for either artifact.
 */
export function hasConfiguredEngineeringFileAccessPublisherPolicy(): boolean {
  return (
    ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY.authenticodeSignerCertificateSha256.length > 0 &&
    ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY.detachedCmsSignerCertificateSha256.length > 0
  );
}

export function isPinnedEngineeringFileAccessAuthenticodePublisher(
  certificateSha256: string
): boolean {
  return matchesPinnedCertificate(
    certificateSha256,
    ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY.authenticodeSignerCertificateSha256
  );
}

export function isPinnedEngineeringFileAccessCmsPublisher(certificateSha256: string): boolean {
  return matchesPinnedCertificate(
    certificateSha256,
    ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY.detachedCmsSignerCertificateSha256
  );
}

/**
 * Use only after each signature has been cryptographically verified. This
 * policy deliberately does not treat a supplied checksum, a manifest claim,
 * or an environment variable as a publisher authority.
 */
export function arePinnedEngineeringFileAccessPublishers(
  publishers: EngineeringFileAccessObservedPublishersV1
): boolean {
  return (
    hasConfiguredEngineeringFileAccessPublisherPolicy() &&
    isPinnedEngineeringFileAccessAuthenticodePublisher(
      publishers.authenticodeSignerCertificateSha256
    ) &&
    isPinnedEngineeringFileAccessCmsPublisher(publishers.detachedCmsSignerCertificateSha256)
  );
}

function matchesPinnedCertificate(certificateSha256: string, pins: readonly string[]): boolean {
  const normalized = certificateSha256.toLowerCase();
  return SHA256_HEX.test(normalized) && pins.includes(normalized);
}

function canonicalJson(value: EngineeringFileAccessPublisherPolicyV1): string {
  return JSON.stringify({
    authenticodeSignerCertificateSha256: value.authenticodeSignerCertificateSha256,
    detachedCmsSignerCertificateSha256: value.detachedCmsSignerCertificateSha256,
    policyId: value.policyId,
    revision: value.revision,
    schemaVersion: value.schemaVersion
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
