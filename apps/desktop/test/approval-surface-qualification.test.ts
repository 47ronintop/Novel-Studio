import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";

import {
  createApprovalSurfaceQualificationProvider,
  createSignedAsarPackageCoverageInspector,
  isMainOwnedApprovalSurfaceQualification,
  loadApprovalSurfaceQualification,
  readApprovalElectronFuseState,
  REQUIRED_ARTIFACTS,
  REQUIRED_PACKAGE_ARTIFACTS,
  APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
  APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
  approvalArtifactManifestChecksum,
  approvalBundleDigest,
  approvalSurfaceQualificationAttestationCanonicalBytes,
  approvalSurfaceQualificationAttestationChecksum,
  classifyWindowsAuthenticodeStatus,
  type ApprovalSurfaceOwnerTrustStore,
  type TrustedApprovalSurfaceQualificationAttestationV1
} from "../src/main/approval-surface-qualification.js";
import { createProductionAgentFeatureFlags } from "../src/main/agent-feature-flags.js";
import { createCreativeFileOperationQualificationService } from "../src/main/creative-file-operation-qualification.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true }))
  );
});

describe("approval surface qualification", () => {
  test("distinguishes unsigned Windows packages from invalid signatures", () => {
    expect(classifyWindowsAuthenticodeStatus("NotSigned\r\n")).toBe("unsigned");
    expect(classifyWindowsAuthenticodeStatus("Valid")).toBe("valid");
    expect(classifyWindowsAuthenticodeStatus("HashMismatch")).toBe("invalid");
    expect(classifyWindowsAuthenticodeStatus("UnknownError")).toBe("invalid");
  });

  test("qualifies only an owner-signed clean production bundle and retains Main provenance", async () => {
    const root = await fixture();
    const owner = ownerSigningKey();
    await writeAttestation(root, owner);
    const loaded = await loadApprovalSurfaceQualification({
      rootDirectory: root,
      buildManifestPath: join(root, "apps/desktop/dist/build-manifest.json"),
      mode: "production",
      packageSignatureInspector: { covers: async (paths) => paths.length === 6 },
      ownerTrustStore: owner.trustStore,
      now: () => "2026-08-06T01:00:00.000Z"
    });
    expect(loaded).toMatchObject({
      ok: true,
      value: { status: "qualified", bundleDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }
    });
    if (!loaded.ok) return;
    expect(isMainOwnedApprovalSurfaceQualification(loaded.value)).toBe(true);
    expect(isMainOwnedApprovalSurfaceQualification({ ...loaded.value })).toBe(false);
    const provider = createApprovalSurfaceQualificationProvider({
      rootDirectory: root,
      buildManifestPath: join(root, "apps/desktop/dist/build-manifest.json"),
      mode: "production",
      packageSignatureInspector: { covers: async () => true },
      ownerTrustStore: owner.trustStore,
      now: () => "2026-08-06T01:00:00.000Z"
    });
    await provider.refresh();
    expect(provider.get()).toMatchObject({ status: "qualified" });

    const activeFlags = createProductionAgentFeatureFlags(
      {
        agentGuidanceV3: true,
        approvalBindingV2: true,
        writingDomainCrudV2: true,
        revision: "qualification-test"
      },
      loaded.value,
      undefined,
      () => "2026-08-06T01:00:00.000Z"
    );
    expect(activeFlags).toMatchObject({ approvalBindingV2: true, writingDomainCrudV2: true });
    expect(activeFlags.revision).toBe(
      `qualification-test:approval-surface:${loaded.value.attestationChecksum}`
    );

    const creativeQualifications = await createCreativeFileOperationQualificationService({
      packageKind: "production",
      now: () => "2026-08-06T01:00:00.000Z",
      candidateInspector: {
        async inspect(operation) {
          return operation === "create_file"
            ? {
                status: "qualified" as const,
                evidenceChecksum: "a".repeat(64),
                issuedAt: "2026-08-01T00:00:00.000Z",
                expiresAt: "2026-08-20T00:00:00.000Z"
              }
            : { status: "unavailable" as const, failureReasons: ["evidence_missing"] as const };
        }
      }
    }).readAll();
    const operationFlags = createProductionAgentFeatureFlags(
      {
        agentGuidanceV3: true,
        approvalBindingV2: true,
        creativeTrustedReplaceV2: true,
        creativeFileCreateV2: true,
        creativeFileMoveV2: true,
        creativeFileDeleteV2: true,
        revision: "creative-qualification-test"
      },
      loaded.value,
      undefined,
      () => "2026-08-06T01:00:00.000Z",
      creativeQualifications
    );
    expect(operationFlags).toMatchObject({
      approvalBindingV2: true,
      creativeTrustedReplaceV2: false,
      creativeFileCreateV2: true,
      creativeFileMoveV2: false,
      creativeFileDeleteV2: false
    });
    expect(operationFlags.revision).toContain("creative-qualification:");

    const expiredFlags = createProductionAgentFeatureFlags(
      {
        agentGuidanceV3: true,
        approvalBindingV2: true,
        writingDomainCrudV2: true,
        revision: "qualification-test"
      },
      loaded.value,
      undefined,
      () => "2026-09-01T00:00:00.000Z"
    );
    expect(expiredFlags).toMatchObject({ approvalBindingV2: false, writingDomainCrudV2: false });
    expect(expiredFlags.revision).toBe("qualification-test:approval-surface:unavailable");
  });

  test("fails closed for development, unsigned coverage, dirty builds and bundle digest drift", async () => {
    const root = await fixture();
    const owner = ownerSigningKey();
    await writeAttestation(root, owner);
    const base = {
      rootDirectory: root,
      buildManifestPath: join(root, "apps/desktop/dist/build-manifest.json"),
      mode: "production" as const,
      packageSignatureInspector: { covers: async () => false },
      ownerTrustStore: owner.trustStore,
      now: () => "2026-08-06T01:00:00.000Z"
    };
    await expect(loadApprovalSurfaceQualification(base)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_PACKAGE_UNCOVERED" }
    });
    await expect(
      loadApprovalSurfaceQualification({ ...base, mode: "development" })
    ).resolves.toMatchObject({ ok: false });
    await writeFile(join(root, "apps/desktop/dist/approval/approval.js"), "drift");
    await expect(
      loadApprovalSurfaceQualification({
        ...base,
        packageSignatureInspector: { covers: async () => true }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_DIGEST_DRIFT" }
    });
  });

  test("fails closed without a pinned Security Architecture Owner key", async () => {
    const root = await fixture();
    await expect(
      loadApprovalSurfaceQualification({
        rootDirectory: root,
        buildManifestPath: join(root, "apps/desktop/dist/build-manifest.json"),
        mode: "production",
        packageSignatureInspector: { covers: async () => true },
        now: () => "2026-08-06T01:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_MISSING" }
    });
    const owner = ownerSigningKey();
    await writeAttestation(root, owner);

    await expect(
      loadApprovalSurfaceQualification({
        rootDirectory: root,
        buildManifestPath: join(root, "apps/desktop/dist/build-manifest.json"),
        mode: "production",
        packageSignatureInspector: { covers: async () => true },
        now: () => "2026-08-06T01:00:00.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_UNTRUSTED_OWNER" }
    });
  });

  test("rejects malformed, forged, stale, and binding-drift attestations", async () => {
    const root = await fixture();
    const owner = ownerSigningKey();
    const options = {
      rootDirectory: root,
      buildManifestPath: join(root, "apps/desktop/dist/build-manifest.json"),
      mode: "production" as const,
      packageSignatureInspector: { covers: async () => true },
      ownerTrustStore: owner.trustStore,
      now: () => "2026-08-06T01:00:00.000Z"
    };

    await writeAttestation(root, owner, { ownerKeyId: "unknown-owner" });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_UNTRUSTED_OWNER" }
    });

    await writeAttestation(root, owner, { qualificationMatrixChecksum: "f".repeat(64) });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_BINDING_MISMATCH" }
    });

    await writeAttestation(root, owner, { sourceRevision: "b".repeat(40) });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_BINDING_MISMATCH" }
    });

    await writeAttestation(root, owner, { approvalArtifactManifestChecksum: "e".repeat(64) });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_BINDING_MISMATCH" }
    });

    await writeAttestation(root, owner, { approvalBundleDigest: "d".repeat(64) });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_BINDING_MISMATCH" }
    });

    await writeAttestation(root, owner, { automatedReportChecksum: "not-a-report-digest" });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_INVALID" }
    });

    await writeAttestation(root, owner, {
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-04-01T00:00:00.000Z"
    });
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_EXPIRED" }
    });

    await writeAttestation(root, owner);
    await writeFile(join(root, APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH), Buffer.alloc(64, 1));
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_SIGNATURE_INVALID" }
    });

    await writeFile(
      join(root, APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH),
      JSON.stringify({ schemaVersion: "1.0", extra: "not allowed" })
    );
    await expect(loadApprovalSurfaceQualification(options)).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_INVALID" }
    });
  });

  test("requires a valid executable signature in addition to active app.asar and integrity fuses", async () => {
    const validSignature = { verify: async () => "valid" as const };
    const inspector = createSignedAsarPackageCoverageInspector({
      resourcesPath: "C:/Program Files/Novel Studio/resources",
      appPath: "C:/Program Files/Novel Studio/resources/app.asar",
      executablePath: "C:/Program Files/ShanHai/ShanHai.exe",
      embeddedAsarIntegrityValidationEnabled: () => true,
      onlyLoadAppFromAsarEnabled: () => true,
      executableCodeSignatureInspector: validSignature
    });
    await expect(inspector.covers(REQUIRED_PACKAGE_ARTIFACTS)).resolves.toBe(true);
    const unsigned = createSignedAsarPackageCoverageInspector({
      resourcesPath: "C:/Program Files/Novel Studio/resources",
      appPath: "C:/Program Files/Novel Studio/resources/app.asar",
      executablePath: "C:/Program Files/ShanHai/ShanHai.exe",
      embeddedAsarIntegrityValidationEnabled: () => true,
      onlyLoadAppFromAsarEnabled: () => true,
      executableCodeSignatureInspector: { verify: async () => "unsigned" }
    });
    await expect(unsigned.covers(REQUIRED_PACKAGE_ARTIFACTS)).resolves.toBe(false);
    const unpacked = createSignedAsarPackageCoverageInspector({
      resourcesPath: "C:/Program Files/Novel Studio/resources",
      appPath: "C:/work/novel-studio",
      executablePath: "C:/Program Files/ShanHai/ShanHai.exe",
      embeddedAsarIntegrityValidationEnabled: () => true,
      onlyLoadAppFromAsarEnabled: () => true,
      executableCodeSignatureInspector: validSignature
    });
    await expect(unpacked.covers(REQUIRED_PACKAGE_ARTIFACTS)).resolves.toBe(false);
  });

  test("reads both required V1 fuse states without a packaged runtime dependency", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-fuse-state-"));
    roots.push(root);
    const executablePath = join(root, "ShanHai.exe");
    const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "ascii");
    const wire = Buffer.from([1, 8, 0x30, 0x30, 0x30, 0x30, 0x31, 0x31, 0x30, 0x30]);
    await writeFile(executablePath, Buffer.concat([Buffer.from("MZ"), sentinel, wire]));

    await expect(readApprovalElectronFuseState(executablePath)).resolves.toEqual({
      embeddedAsarIntegrityValidationEnabled: true,
      onlyLoadAppFromAsarEnabled: true
    });

    wire[7] = 0x30;
    await writeFile(executablePath, Buffer.concat([Buffer.from("MZ"), sentinel, wire]));
    await expect(readApprovalElectronFuseState(executablePath)).resolves.toEqual({
      embeddedAsarIntegrityValidationEnabled: true,
      onlyLoadAppFromAsarEnabled: false
    });
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "approval-qualification-"));
  roots.push(root);
  const artifacts: Record<string, { path: string; sha256: string; sourceRevision: string }> = {};
  for (const [name, relative] of Object.entries(REQUIRED_ARTIFACTS)) {
    const path = join(root, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, name);
    const bytes = await readFile(path);
    artifacts[name] = {
      path: relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sourceRevision: "a".repeat(40)
    };
  }
  await writeFile(
    join(root, "apps/desktop/dist/build-manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      sourceRevision: "a".repeat(40),
      sourceDirty: false,
      artifacts
    })
  );
  return root;
}

function ownerSigningKey(): {
  readonly privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  readonly trustStore: ApprovalSurfaceOwnerTrustStore;
} {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKey: keys.privateKey,
    trustStore: Object.freeze({
      "security-architecture-owner-test": keys.publicKey
        .export({ format: "pem", type: "spki" })
        .toString()
    })
  };
}

async function writeAttestation(
  root: string,
  owner: ReturnType<typeof ownerSigningKey>,
  overrides: Partial<TrustedApprovalSurfaceQualificationAttestationV1> = {}
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(root, "apps/desktop/dist/build-manifest.json"), "utf8")
  ) as {
    readonly sourceRevision: string;
    readonly artifacts: Record<string, { readonly path: string; readonly sha256: string }>;
  };
  const bundleDigest = approvalBundleDigest(
    Object.values(REQUIRED_ARTIFACTS).map((path) => {
      const artifact = Object.values(manifest.artifacts).find(
        (candidate) => candidate.path === path
      );
      if (artifact === undefined) throw new Error(`Missing fixture artifact: ${path}`);
      return `${path}\n${artifact.sha256}`;
    })
  );
  const unsigned = {
    schemaVersion: "1.0" as const,
    authority: "security_architecture_owner" as const,
    qualificationRevision: "approval-ui-q1",
    sourceRevision: manifest.sourceRevision,
    approvalBundleDigest: bundleDigest,
    approvalArtifactManifestChecksum: approvalArtifactManifestChecksum(manifest),
    qualificationMatrixRevision: APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.revision,
    qualificationMatrixChecksum: APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
    automatedReportChecksum: "c".repeat(64),
    ownerApprovalId: "security-review-1",
    ownerKeyId: "security-architecture-owner-test",
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
  const attestation: TrustedApprovalSurfaceQualificationAttestationV1 = {
    ...unsigned,
    attestationChecksum: approvalSurfaceQualificationAttestationChecksum(unsigned)
  };
  await mkdir(join(root, "apps/desktop/dist/approval"), { recursive: true });
  await writeFile(
    join(root, APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH),
    JSON.stringify(attestation),
    "utf8"
  );
  await writeFile(
    join(root, APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH),
    sign(null, approvalSurfaceQualificationAttestationCanonicalBytes(attestation), owner.privateKey)
  );
}
