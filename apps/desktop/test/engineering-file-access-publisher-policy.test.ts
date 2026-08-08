import { describe, expect, test } from "vitest";

import {
  ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY,
  ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM,
  arePinnedEngineeringFileAccessPublishers,
  hasConfiguredEngineeringFileAccessPublisherPolicy,
  isPinnedEngineeringFileAccessAuthenticodePublisher,
  isPinnedEngineeringFileAccessCmsPublisher
} from "../src/main/engineering-file-access-publisher-policy.js";

describe("engineering file access publisher policy", () => {
  test("is compiled, immutable, and deliberately unconfigured until a reviewed owner pin is added", () => {
    expect(Object.isFrozen(ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY)).toBe(true);
    expect(
      Object.isFrozen(ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY.authenticodeSignerCertificateSha256)
    ).toBe(true);
    expect(
      Object.isFrozen(ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY.detachedCmsSignerCertificateSha256)
    ).toBe(true);
    expect(ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM).toMatch(/^[a-f0-9]{64}$/u);
    expect(hasConfiguredEngineeringFileAccessPublisherPolicy()).toBe(false);
  });

  test("fails closed for arbitrary, malformed, and environment-shaped certificate values", () => {
    const arbitraryCertificate = "a".repeat(64);
    expect(isPinnedEngineeringFileAccessAuthenticodePublisher(arbitraryCertificate)).toBe(false);
    expect(isPinnedEngineeringFileAccessCmsPublisher(arbitraryCertificate)).toBe(false);
    expect(isPinnedEngineeringFileAccessAuthenticodePublisher("CMS_TRUST_STORE")).toBe(false);
    expect(isPinnedEngineeringFileAccessCmsPublisher("not-a-certificate-digest")).toBe(false);
    expect(
      arePinnedEngineeringFileAccessPublishers({
        authenticodeSignerCertificateSha256: arbitraryCertificate,
        detachedCmsSignerCertificateSha256: arbitraryCertificate
      })
    ).toBe(false);
  });
});
