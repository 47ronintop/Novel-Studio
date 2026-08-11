import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

// @ts-expect-error The probe is executable JavaScript and intentionally has no desktop type surface.
import {
  createEngineeringFileAccessPackageProbeRequest,
  mutationV2ProbeAvailabilityFor,
  probeEngineeringStateDurabilityAbi,
  probeMutationV2Abi,
  probeReadOnlyAbi,
  readOnlyAvailabilityFor
} from "../../../scripts/probe-engineering-file-access-package.mjs";

const fixturePath = fileURLToPath(
  new URL("./engineering-file-access-probe-fixtures/ordinary-utf8.txt", import.meta.url)
);

describe("engineering file access development probe contract", () => {
  test("uses the same newline-delimited metadata checksum bytes in native, probe, and Main", async () => {
    const canonical = "engineering_file_metadata_v2\nattributes=128";
    const [nativeSource, probeSource, sessionSource] = await Promise.all([
      readFile("native/engineering-file-access-win32/src/engineering_file_access.cc", "utf8"),
      readFile("scripts/probe-engineering-file-access-package.mjs", "utf8"),
      readFile("apps/desktop/src/main/engineering-file-mutation-session-v2.ts", "utf8")
    ]);

    expect(createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex")).toBe(
      "b0d65be91fea83453ae872b80df36ba2dea9b4410245a3680dbcde665dcf21e9"
    );
    expect(nativeSource).toContain('"engineering_file_metadata_v2\\nattributes="');
    expect(nativeSource).not.toContain('"engineering_file_metadata_v2\\\\nattributes="');
    expect(probeSource).toContain("engineering_file_metadata_v2\\nattributes=${attributes}");
    expect(sessionSource).toContain('"engineering_file_metadata_v2\\nattributes=128"');
  });

  test("keeps B7 replace handoff handle-bound, create-only, and recovery-visible", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );

    expect(nativeSource).toContain("FILE_READ_DATA | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE");
    expect(nativeSource).toContain('return stagingLeafName("before-" + stagingId);');
    expect(
      nativeSource.match(
        /renameOpenedFileCreateOnly\(targetHandle\.get\(\), handoffParentHandle\.get\(\), recoveryLeaf\)/gu
      )?.length
    ).toBe(2);
    expect(
      nativeSource.match(
        /renameOpenedFileCreateOnly\(stageHandle\.get\(\), handoffParentHandle\.get\(\), leafName\)/gu
      )?.length
    ).toBeGreaterThanOrEqual(4);
    expect(nativeSource).not.toContain(
      "renameOpenedFile(stageHandle.get(), parentHandle.get(), leafName, true)"
    );
    expect(
      nativeSource.match(
        /deleteRecoveryBeforeFile\(targetHandle\.get\(\), recoveryLeaf,[\s\S]{0,240}targetHandle\.close\(\)[\s\S]{0,240}FlushFileBuffers\(handoffParentHandle\.get\(\)\)/gu
      )?.length
    ).toBe(2);
    for (const faultPath of [
      "replace_handle_bound_target_swap_no_overwrite",
      "replace_create_only_handoff_collision_recovery",
      "replace_after_original_handoff_recovery",
      "replace_before_candidate_handoff_recovery",
      "replace_after_candidate_handoff_recovery"
    ]) {
      expect(nativeSource).toContain(faultPath);
    }
  });

  test("restores fixed create metadata after the Windows rename handoff", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );

    expect(nativeSource.match(/applyFixedCreateMetadataV2\(stageHandle\.get\(\)\)/gu)?.length).toBe(
      2
    );
    expect(nativeSource).toMatch(
      /renameOpenedFileCreateOnly\(stageHandle\.get\(\), handoffParentHandle\.get\(\), leafName\);\s+\/\/ Windows marks a renamed file as ARCHIVE,[\s\S]{0,320}applyFixedCreateMetadataV2\(stageHandle\.get\(\)\)[\s\S]{0,160}flushDurably\(stageHandle\.get\(\), DurableFlushKind::kData\)/u
    );
  });

  test("uses the SDK-compatible native create-only hard-link ABI for state durability", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );

    expect(nativeSource).toContain("constexpr ULONG kFileLinkInformation = 11;");
    expect(nativeSource).toContain("using NtSetInformationFileFn");
    expect(nativeSource).toContain(
      'GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtSetInformationFile")'
    );
    expect(nativeSource).toContain("link->replaceIfExists = FALSE;");
    expect(nativeSource).toContain("link->rootDirectory = parent;");
    expect(nativeSource).toContain("kFileLinkInformation");
    expect(nativeSource).not.toContain("SetFileInformationByHandle(existing, FileLinkInfo");
    expect(nativeSource).toContain("constexpr ULONG kFileRenameInformation = 10;");
    expect(nativeSource).toContain("rename->replaceIfExists = FALSE;");
    expect(nativeSource).toContain("rename->rootDirectory = parent;");
    expect(nativeSource).toContain("kFileRenameInformation");
    expect(nativeSource).toContain("openMutationHandoffDirectory");
    expect(nativeSource).toContain("FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE");
    expect(nativeSource).toContain("!sameObjectKey(expectedIdentity, observedIdentity)");
    expect(
      nativeSource.match(/revalidateReplaceNamespace\(handoffParentHandle\.get\(\)/gu)?.length
    ).toBe(1);
    expect(
      nativeSource.match(/revalidateV2ReplaceNamespace\(handoffParentHandle\.get\(\)/gu)?.length
    ).toBe(1);
    expect(nativeSource).toContain("ShareAccess=0 pins this staged object");
  });

  test("reopens identity-proven move parents for rename handoff, including same-parent case-only moves", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );
    const moveStart = nativeSource.indexOf("napi_value moveEngineeringPathV2");
    const moveEnd = nativeSource.indexOf("napi_value mutationV2ProbeInfo");
    const compensateStart = nativeSource.indexOf("AccessError compensateLifecycleMove");
    const compensateEnd = nativeSource.indexOf(
      "AccessError compensateLifecycleDelete",
      compensateStart
    );
    const handoffStart = nativeSource.indexOf("AccessError openMutationHandoffDirectory");
    const handoffEnd = nativeSource.indexOf("AccessError openMutationFile", handoffStart);

    expect(moveStart).toBeGreaterThanOrEqual(0);
    expect(moveEnd).toBeGreaterThan(moveStart);
    expect(compensateStart).toBeGreaterThan(moveStart);
    expect(compensateEnd).toBeGreaterThan(compensateStart);
    expect(handoffStart).toBeGreaterThanOrEqual(0);
    expect(handoffEnd).toBeGreaterThan(handoffStart);

    const moveSource = nativeSource.slice(moveStart, moveEnd);
    const compensateSource = nativeSource.slice(compensateStart, compensateEnd);
    const handoffSource = nativeSource.slice(handoffStart, handoffEnd);

    expect(handoffSource).toContain("const BY_HANDLE_FILE_INFORMATION& expectedIdentity");
    expect(handoffSource).toContain("FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE");
    expect(handoffSource).toContain(
      "!GetFileInformationByHandle(parent, &observedIdentity) || !sameObjectKey(expectedIdentity, observedIdentity)"
    );

    expect(moveSource).toContain(
      "_wcsicmp(sourceParentPath.c_str(), destinationParentPath.c_str()) == 0;"
    );
    expect(moveSource).toContain(
      "const bool destinationParentIsBelowSourceParent = !sameParent &&"
    );
    expect(moveSource).toMatch(
      /sourceParentPath\.empty\(\) \|\|\s+isPathAncestorOrSame\(sourceParentPath, destinationParentPath\)/u
    );
    const descendantInitialStart = moveSource.indexOf(
      "} else if (destinationParentIsBelowSourceParent) {"
    );
    const descendantInitialEnd = moveSource.indexOf("} else {", descendantInitialStart);
    const descendantInitialSource = moveSource.slice(descendantInitialStart, descendantInitialEnd);
    expect(descendantInitialStart).toBeGreaterThanOrEqual(0);
    expect(descendantInitialSource.indexOf("destinationParentPath")).toBeLessThan(
      descendantInitialSource.indexOf("sourceParentPath")
    );
    expect(moveSource).toContain("destinationParentIdentity = sourceParentIdentity;");
    expect(moveSource).toMatch(
      /!sourceParentHandle\.close\(\) \|\| !destinationParentHandle\.close\(\)/u
    );
    expect(moveSource).toContain(
      "openMutationHandoffDirectory(rootId, sourceParentPath, sourceParentIdentity, &handoffSourceRaw)"
    );
    expect(moveSource).toContain(
      "openMutationHandoffDirectory(rootId, destinationParentPath, destinationParentIdentity,"
    );
    const descendantHandoffStart = moveSource.indexOf(
      "if (result == AccessError::kOk && destinationParentIsBelowSourceParent) {"
    );
    const descendantHandoffEnd = moveSource.indexOf(
      "} else if (result == AccessError::kOk && !sameParent)",
      descendantHandoffStart
    );
    const descendantHandoffSource = moveSource.slice(descendantHandoffStart, descendantHandoffEnd);
    expect(descendantHandoffStart).toBeGreaterThanOrEqual(0);
    expect(descendantHandoffSource.indexOf("destinationParentPath")).toBeLessThan(
      descendantHandoffSource.indexOf("sourceParentPath")
    );
    expect(moveSource).toContain("handoffDestinationRaw = handoffSourceRaw;");
    expect(moveSource).toContain("handoffSourceRaw = INVALID_HANDLE_VALUE;");
    expect(moveSource).toContain(
      "const HANDLE moveSourceParent = sameParent ? handoffDestinationParent.get() : handoffSourceParent.get();"
    );
    expect(moveSource).toContain(
      "const HANDLE moveDestinationParent = handoffDestinationParent.get();"
    );

    expect(moveSource).toContain(
      'const bool caseOnly = request.targetProof == "same_object_case_only";'
    );
    expect(moveSource).toContain(
      "if (!sameParent || _wcsicmp(sourceLeaf.c_str(), destinationLeaf.c_str()) != 0 ||"
    );
    expect(moveSource).toContain(
      "renameOpenedFileCreateOnly(sourceHandle.get(), moveDestinationParent, temporaryLeaf);"
    );
    expect(moveSource).toContain(
      "renameOpenedFileCreateOnly(sourceHandle.get(), moveDestinationParent, destinationLeaf);"
    );
    expect(moveSource).toContain(
      "openMutationLeaf(moveDestinationParent, destinationLeaf, &finalRaw);"
    );

    expect(compensateSource).toContain(
      "_wcsicmp(sourceParentPath.c_str(), targetParentPath.c_str()) == 0;"
    );
    expect(compensateSource).toContain(
      "const bool targetParentIsBelowSourceParent = !sameParent &&"
    );
    expect(compensateSource).toMatch(
      /else if \(targetParentIsBelowSourceParent\) \{[\s\S]{0,320}targetParentPath[\s\S]{0,240}sourceParentPath/u
    );
    expect(compensateSource).toMatch(
      /if \(result == AccessError::kOk && targetParentIsBelowSourceParent\) \{[\s\S]{0,360}targetParentPath[\s\S]{0,320}sourceParentPath/u
    );
  });

  test("reuses the lifecycle marker parent while classifying create, move, and delete operations", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );
    const classifyStart = nativeSource.indexOf("AccessError classifyLifecycleOperation");
    const classifyEnd = nativeSource.indexOf("AccessError removeLifecycleMarker", classifyStart);

    expect(classifyStart).toBeGreaterThanOrEqual(0);
    expect(classifyEnd).toBeGreaterThan(classifyStart);

    const classifySource = nativeSource.slice(classifyStart, classifyEnd);
    expect(classifySource).toContain("HANDLE parentRaw = markerParent.release();");
    expect(classifySource).toContain("HANDLE sourceParentRaw = markerParent.release();");
    expect(classifySource).not.toContain("openMutationDirectory(rootId, parentPath, &parentRaw)");
    expect(classifySource).not.toContain(
      "openMutationDirectory(rootId, sourceParentPath, &sourceParentRaw)"
    );
    expect(classifySource).toContain(
      "_wcsicmp(sourceParentPath.c_str(), targetParentPath.c_str()) == 0;"
    );
    expect(classifySource).toContain("const bool targetParentIsBelowSourceParent = !sameParent &&");
    expect(classifySource).toContain(
      "openMutationDescendantDirectory(sourceParent.get(), sourceParentPath, targetParentPath,"
    );

    const descendantOpenStart = nativeSource.indexOf("AccessError openMutationDescendantDirectory");
    const descendantOpenEnd = nativeSource.indexOf(
      "AccessError openMutationDirectory(uint64_t rootId",
      descendantOpenStart
    );
    expect(descendantOpenStart).toBeGreaterThanOrEqual(0);
    expect(descendantOpenEnd).toBeGreaterThan(descendantOpenStart);
    const descendantOpenSource = nativeSource.slice(descendantOpenStart, descendantOpenEnd);
    expect(descendantOpenSource).toContain("parseRelativePath(descendantSuffix, false, &segments)");
    expect(descendantOpenSource).toContain("OBJ_CASE_INSENSITIVE");
    expect(descendantOpenSource).toContain("FILE_SHARE_READ");
    expect(descendantOpenSource).toContain("noFollowOpenOption()");
    expect(descendantOpenSource).toContain("verifyDirectory(next)");
    expect(descendantOpenSource).toContain("hasExpectedLeafName(next, segments[index])");
  });

  test("invokes the quarantine addon with its exact three-argument ABI", async () => {
    const probeSource = await readFile("scripts/probe-engineering-file-access-package.mjs", "utf8");

    const quarantineCallStart = probeSource.indexOf("addon.quarantineEngineeringFileV2(");
    const quarantineCallEnd = probeSource.indexOf(");", quarantineCallStart) + 2;
    expect(quarantineCallStart).toBeGreaterThanOrEqual(0);
    expect(probeSource.slice(quarantineCallStart, quarantineCallEnd).replace(/\r\n/gu, "\n")).toBe(
      `addon.quarantineEngineeringFileV2(
          rootId,
          recoveryBinding.recoveryRootId,
          quarantineRequest
        );`
    );
  });

  test("reopens the restore target parent for the create-only rename handoff", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );
    const restoreStart = nativeSource.indexOf("napi_value restoreEngineeringFileV2");
    const restoreEnd = nativeSource.indexOf(
      "napi_value purgeEngineeringQuarantineObjectV2",
      restoreStart
    );
    expect(restoreStart).toBeGreaterThanOrEqual(0);
    expect(restoreEnd).toBeGreaterThan(restoreStart);

    const restoreSource = nativeSource.slice(restoreStart, restoreEnd);
    expect(restoreSource).toContain("GetFileInformationByHandle(parent.get(), &parentIdentity)");
    expect(restoreSource).toContain("!parent.close()");
    expect(restoreSource).toContain(
      "openMutationHandoffDirectory(rootId, parentPath, parentIdentity, &handoffRaw)"
    );
    expect(restoreSource).toContain("checkRelativeLeafAbsent(handoff.get(), leaf)");
    expect(restoreSource).toContain(
      "renameOpenedFileCreateOnly(object.get(), handoff.get(), leaf)"
    );
    expect(restoreSource).not.toContain(
      "renameOpenedFileCreateOnly(object.get(), parent.get(), leaf)"
    );
  });

  test("retains lifecycle markers until durable WAL finalize and exposes bounded recovery primitives", async () => {
    const nativeSource = await readFile(
      "native/engineering-file-access-win32/src/engineering_file_access.cc",
      "utf8"
    );

    const makeStringDeclaration = nativeSource.indexOf(
      "napi_value makeString(napi_env env, const char* value);"
    );
    const firstMakeStringCall = nativeSource.indexOf("makeString(env");
    expect(makeStringDeclaration).toBeGreaterThanOrEqual(0);
    expect(firstMakeStringCall).toBeGreaterThan(makeStringDeclaration);

    expect(nativeSource).toContain("napi_value objects = nullptr;");

    expect(nativeSource).toContain("engineering_lifecycle_marker_v1");
    expect(nativeSource).toContain('LifecycleMarker{requestChecksum, "case_intermediate"');
    expect(nativeSource).toContain('LifecycleMarker{requestChecksum, "after"');
    expect(nativeSource).toContain("napi_value inspectEngineeringFileLifecycleOperationV2");
    expect(nativeSource).toContain("napi_value resumeEngineeringFileLifecycleOperationV2");
    expect(nativeSource).toContain("napi_value compensateEngineeringFileLifecycleOperationV2");
    expect(nativeSource).toContain("napi_value finalizeEngineeringFileLifecycleOperationV2");
    expect(nativeSource).toContain("napi_value inspectEngineeringQuarantineV2");
    expect(nativeSource).toContain("napi_value openEngineeringStateRootBoundToRecoveryV2");
    expect(nativeSource).toContain("napi_value inspectEngineeringRecoveryRootCapacityV2");
    expect(nativeSource).toContain("GetDiskFreeSpaceExW(volumeRoot.c_str()");
    expect(nativeSource).toContain('makeString(env, "engineering_quarantine_inventory")');
    expect(nativeSource).toContain('name == L".novel-studio-engineering-v2"');
    expect(nativeSource).toContain("DuplicateHandle(GetCurrentProcess(), found->second.handle");
    const recoveryOpenStart = nativeSource.indexOf("AccessError openRecoveryDirectory");
    const lifecycleParserStart = nativeSource.indexOf(
      "bool readLifecycleString",
      recoveryOpenStart
    );
    expect(nativeSource.slice(recoveryOpenStart, lifecycleParserStart)).not.toContain(
      "CreateFileW(session.path.c_str()"
    );
    expect(nativeSource).toContain("classification != LifecycleClassification::kAfter");
    expect(nativeSource).toContain("directoryIsEmpty(directory.get(), &empty)");
    expect(nativeSource).toContain(
      "renameOpenedFileCreateOnly(object.get(), parent.get(), sourceLeaf)"
    );
    const inspectStart = nativeSource.indexOf(
      "napi_value inspectEngineeringFileLifecycleOperationV2"
    );
    const resumeStart = nativeSource.indexOf(
      "napi_value resumeEngineeringFileLifecycleOperationV2"
    );
    const inspectSource = nativeSource.slice(inspectStart, resumeStart);
    expect(inspectSource).not.toContain("completeCaseIntermediate(rootId, request)");
    expect(inspectSource).not.toContain("completeDirectoryIntermediate(rootId, request)");
    const compensateStart = nativeSource.indexOf(
      "napi_value compensateEngineeringFileLifecycleOperationV2"
    );
    const resumeSource = nativeSource.slice(resumeStart, compensateStart);
    expect(resumeSource).toContain("completeCaseIntermediate(rootId, request)");
    expect(resumeSource).toContain("completeDirectoryIntermediate(rootId, request)");
    expect(nativeSource).toContain("validateExpectedLifecycleReceipt(env, argv[3], *request)");
    expect(nativeSource).toContain('expectedState == "after"');
    expect(nativeSource).toContain("if (result == AccessError::kOk && !markerPresent)");
    expect(nativeSource).toContain(
      '{"inspectEngineeringFileLifecycleOperationV2", nullptr, inspectEngineeringFileLifecycleOperationV2'
    );
    expect(nativeSource).toContain(
      '{"openEngineeringStateRootBoundToRecoveryV2", nullptr, openEngineeringStateRootBoundToRecoveryV2'
    );
    expect(nativeSource).toContain(
      '{"inspectEngineeringRecoveryRootCapacityV2", nullptr, inspectEngineeringRecoveryRootCapacityV2'
    );
    expect(nativeSource).toContain(
      '{"resumeEngineeringFileLifecycleOperationV2", nullptr, resumeEngineeringFileLifecycleOperationV2'
    );
    expect(nativeSource).toContain(
      '{"compensateEngineeringFileLifecycleOperationV2", nullptr, compensateEngineeringFileLifecycleOperationV2'
    );
    expect(nativeSource).toContain(
      '{"finalizeEngineeringFileLifecycleOperationV2", nullptr, finalizeEngineeringFileLifecycleOperationV2'
    );
  });

  test("requires Main to provide absolute installed inputs and a distinct output path", () => {
    const request = createEngineeringFileAccessPackageProbeRequest({
      artifactPath: "C:\\Program Files\\Novel Studio\\engineering_file_access.node",
      manifestPath: "C:\\Program Files\\Novel Studio\\engineering_file_access.manifest.json",
      signaturePath: "C:\\Program Files\\Novel Studio\\engineering_file_access.manifest.p7s",
      reportPath: "C:\\Users\\main\\AppData\\Local\\Temp\\engineering-file-access.probe.json",
      packageKind: "production",
      evidencePath: "C:\\Users\\main\\AppData\\Local\\Temp\\engineering-file-access.evidence.json"
    });

    expect(request).toMatchObject({
      artifactPath: "C:\\Program Files\\Novel Studio\\engineering_file_access.node",
      packageKind: "production",
      reportPath: "C:\\Users\\main\\AppData\\Local\\Temp\\engineering-file-access.probe.json"
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(() =>
      createEngineeringFileAccessPackageProbeRequest({
        ...request,
        artifactPath: "native/engineering_file_access.node"
      })
    ).toThrow("artifactPath must be an absolute path");
    expect(() =>
      createEngineeringFileAccessPackageProbeRequest({
        ...request,
        evidencePath: undefined
      })
    ).toThrow("production probe request requires an absolute evidencePath");
    expect(() =>
      createEngineeringFileAccessPackageProbeRequest({
        ...request,
        reportPath: request.artifactPath
      })
    ).toThrow("reportPath must be separate from installed artifact inputs");
  });

  test("exercises the read-only ABI with a deterministic ordinary UTF-8 read and safe traversal canaries", async () => {
    const fixture = normalizeProbeFixture(await readFile(fixturePath, "utf8"));
    const adapter = hardenedReadOnlyFixtureAdapter(fixture);

    await expect(probeReadOnlyAbi(adapter)).resolves.toMatchObject({
      status: "passed",
      ordinaryUtf8Read: "passed",
      ordinaryUtf8List: "passed",
      ordinaryUtf8Index: "passed",
      ordinaryUtf8Search: "passed",
      rootRelativeTraversal: "passed",
      rejectedPaths: expect.arrayContaining([
        "../engineering-file-access-probe-outside.txt",
        "docs/../../engineering-file-access-probe-outside.txt",
        "C:\\engineering-file-access-probe-outside.txt",
        "\\\\server\\share\\engineering-file-access-probe-outside.txt"
      ])
    });
    expect(adapter.paths).toEqual(
      expect.arrayContaining([
        "docs/ordinary-utf8.txt",
        "../engineering-file-access-probe-outside.txt"
      ])
    );
  });

  test("fails closed when an otherwise available ABI reads an adversarial path", async () => {
    const adapter = hardenedReadOnlyFixtureAdapter(
      normalizeProbeFixture(await readFile(fixturePath, "utf8"))
    );
    const hardenedRead = adapter.readFile;
    adapter.readFile = (rootId: bigint, relativePath: string) => {
      adapter.paths.push(relativePath);
      if (relativePath === "docs/ordinary-utf8.txt") return hardenedRead(rootId, relativePath);
      return Buffer.from("incorrectly reachable", "utf8");
    };

    await expect(probeReadOnlyAbi(adapter)).rejects.toThrow(
      'B6 readFile unexpectedly accepted adversarial path: "../engineering-file-access-probe-outside.txt"'
    );
  });

  test("allows only complete read-only capability declarations", async () => {
    expect(
      readOnlyAvailabilityFor({
        eligibility: {
          root: "unavailable",
          access: "unavailable",
          read: "unavailable",
          index: "unavailable"
        }
      })
    ).toBe("unavailable");
    expect(
      readOnlyAvailabilityFor({
        eligibility: {
          root: "available",
          access: "available",
          read: "available",
          index: "available"
        }
      })
    ).toBe("available");
    expect(() =>
      readOnlyAvailabilityFor({
        eligibility: {
          root: "available",
          access: "unavailable",
          read: "unavailable",
          index: "unavailable"
        }
      })
    ).toThrow("must not partially advertise B6 read-only capabilities");
  });

  test("requires a B7 mutation probe declaration to retain B6 product fail-closed eligibility", () => {
    const sourceIdentitySha256 = "a".repeat(64);
    const toolchainIdentitySha256 = "b".repeat(64);
    const manifest = {
      sourceIdentity: { sha256: sourceIdentitySha256 },
      toolchain: { sha256: toolchainIdentitySha256 },
      buildIdentity: { sha256: "c".repeat(64) },
      developmentMutationV2Probe: {
        schemaVersion: "1.0",
        batch: "7",
        sourceIdentitySha256,
        toolchainIdentitySha256,
        primitives: {
          rawByteBlobs: "available",
          absenceProof: "available",
          absenceProofV2: "available",
          objectMutationAbi: "available",
          targetInspection: "available",
          operationStateReconciliation: "available",
          handleRelativeRevalidation: "available",
          finalRenameNamespaceRevalidation: "available",
          hardLinkPolicy: "reject_multiple_links",
          copyOnReplace: "not_enabled",
          fixedCreateMetadata: "available",
          receiptDurability: "available",
          stagingWalRecoveryScan: "available",
          faultProbe: "available",
          stateDurability: "available"
        },
        productCapability: "unavailable"
      }
    };
    expect(mutationV2ProbeAvailabilityFor(manifest)).toBe("available");
    expect(() =>
      mutationV2ProbeAvailabilityFor({
        ...manifest,
        developmentMutationV2Probe: {
          ...manifest.developmentMutationV2Probe,
          primitives: {
            ...manifest.developmentMutationV2Probe.primitives,
            stateDurability: "unavailable"
          }
        }
      })
    ).toThrow("incomplete or unsafe");
    expect(() =>
      mutationV2ProbeAvailabilityFor({
        ...manifest,
        developmentMutationV2Probe: {
          ...manifest.developmentMutationV2Probe,
          productCapability: "available"
        }
      })
    ).toThrow("incomplete or unsafe");
  });

  test("exercises B7 raw-byte replace/create, rejection canaries, and recovery scan on the same fixture addon", async () => {
    const adapter = hardenedReadOnlyFixtureAdapter(
      normalizeProbeFixture(await readFile(fixturePath, "utf8"))
    );
    await expect(probeMutationV2Abi(adapter)).resolves.toMatchObject({
      status: "passed",
      objectReplace: "passed",
      objectCreate: "passed",
      objectReceiptBinding: "passed",
      walPreparation: "passed",
      recoveryScan: "passed",
      rawByteCandidateBefore: "passed",
      absenceProof: "passed",
      absenceProofV2: "passed",
      objectMutationAbi: "passed",
      targetInspection: "passed",
      operationStateReconciliation: "passed",
      handleRelativeRevalidation: "passed",
      finalRenameNamespaceRevalidation: "passed",
      handleBoundReplaceHandoff: "passed",
      hardLinkRejection: "passed",
      receiptDurability: "passed",
      recoveryBeforeCleanup: "passed",
      negativeCanaries: {
        rawByteManifestMismatch: "canary_exposed",
        walBindingMismatch: "canary_exposed",
        hardLinkLeaf: "canary_exposed",
        staleAbsenceProof: "canary_exposed",
        v2RawByteManifestMismatch: "canary_exposed",
        v2StaleAbsenceProof: "canary_exposed",
        objectV2RawByteManifestMismatch: "canary_exposed",
        objectV2StaleBase: "canary_exposed",
        objectV2CreateRace: "canary_exposed",
        objectV2FaultRecoveryRequired: "canary_exposed",
        replaceFinalRenameNamespaceRevalidation: "canary_exposed",
        targetSwapFinalWindowNoOverwrite: "canary_exposed",
        createOnlyHandoffCollisionRecoveryRequired: "canary_exposed"
      },
      faultProbe: {
        nativeExport: "passed",
        orphanStagingRecoveryRequired: "canary_exposed",
        replaceFinalRenameNamespaceRevalidation: "canary_exposed",
        afterOriginalHandoffRecoveryRequired: "canary_exposed",
        beforeCandidateHandoffRecoveryRequired: "canary_exposed",
        afterCandidateHandoffRecoveryRequired: "canary_exposed"
      }
    });
  });

  test("exercises Main-only app-state no-follow durability without adding a Provider operation", async () => {
    await expect(
      probeEngineeringStateDurabilityAbi(stateDurabilityFixtureAdapter())
    ).resolves.toMatchObject({
      status: "passed",
      noFollowDirectory: "passed",
      exclusiveWriteAndFlush: "passed",
      createOnlyHardLinkInstall: "passed",
      atomicReplaceRename: "passed",
      noFollowReadAndList: "passed",
      unlinkAndDirectoryFlush: "passed"
    });
  });
});

function stateDurabilityFixtureAdapter() {
  const files = new Map<string, Buffer>();
  const handles = new Map<bigint, { path: string; bytes: Buffer }>();
  let nextHandle = 1n;
  return {
    openEngineeringStateRoot: () => 1n,
    closeEngineeringStateRoot: () => true,
    ensureEngineeringStateDirectoryNoFollow: () => undefined,
    flushEngineeringStateDirectory: () => undefined,
    openEngineeringStateExclusiveNoFollow: (_rootId: bigint, path: string) => {
      if (files.has(path)) throw new Error("exists");
      const handle = nextHandle++;
      handles.set(handle, { path, bytes: Buffer.alloc(0) });
      return handle;
    },
    writeEngineeringStateFile: (handle: bigint, bytes: Uint8Array) => {
      const current = handles.get(handle);
      if (!current) throw new Error("closed");
      current.bytes = Buffer.from(bytes);
    },
    syncEngineeringStateFile: (handle: bigint) => {
      if (!handles.has(handle)) throw new Error("closed");
    },
    closeEngineeringStateFile: (handle: bigint) => {
      const current = handles.get(handle);
      if (!current) throw new Error("closed");
      files.set(current.path, current.bytes);
      handles.delete(handle);
    },
    readEngineeringStateFileNoFollow: (_rootId: bigint, path: string) => {
      const current = files.get(path);
      if (!current) throw new Error("missing");
      return Buffer.from(current);
    },
    readEngineeringStateDirectoryNoFollow: (_rootId: bigint, directory: string) =>
      [...files.keys()]
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => ({ name: path.slice(directory.length + 1), kind: "file" })),
    linkEngineeringStateFileNoFollow: (_rootId: bigint, existing: string, target: string) => {
      const current = files.get(existing);
      if (!current || files.has(target)) throw new Error("link failed");
      files.set(target, Buffer.from(current));
    },
    renameReplaceEngineeringStateFileNoFollow: (
      _rootId: bigint,
      oldPath: string,
      newPath: string
    ) => {
      const current = files.get(oldPath);
      if (!current) throw new Error("missing");
      files.set(newPath, current);
      files.delete(oldPath);
    },
    unlinkEngineeringStateFileNoFollow: (_rootId: bigint, path: string) => {
      if (!files.delete(path)) throw new Error("missing");
    }
  };
}

function hardenedReadOnlyFixtureAdapter(expectedFixture: string) {
  let workspaceRoot: string | undefined;
  const expectedBytes = Buffer.from(expectedFixture, "utf8");
  let nextProofId = 1n;
  let nextWalBindingId = 1n;
  let recoveryRequired = false;
  const absenceProofs = new Map<bigint, { parent: string; leaf: string }>();
  const walBindings = new Map<
    bigint,
    { transactionId: string; operationId: string; stagingId: string; checksum: string }
  >();
  const identity = {
    volumeIdentity: "d0c0b0a0",
    fileIdentity: "0000000000000001"
  };
  const rawManifest = (bytes: Buffer) => ({
    byteLength: BigInt(bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    encoding: "utf8",
    bom: "none",
    eol: "lf"
  });
  const sameManifest = (bytes: Buffer, manifest: ReturnType<typeof rawManifest>) =>
    manifest.byteLength === BigInt(bytes.byteLength) &&
    manifest.sha256 === createHash("sha256").update(bytes).digest("hex") &&
    manifest.encoding === "utf8" &&
    manifest.bom === "none" &&
    manifest.eol === "lf";
  const readWorkspaceFile = (relativePath: string) => {
    if (!workspaceRoot) throw new Error("fixture root is closed");
    return readFileSync(join(workspaceRoot, relativePath));
  };
  const walFor = (
    rootId: bigint,
    transactionId: string,
    operationId: string,
    stagingId: string,
    walBindingId: bigint
  ) => {
    const binding = walBindings.get(walBindingId);
    if (
      rootId !== 1n ||
      !binding ||
      binding.transactionId !== transactionId ||
      binding.operationId !== operationId ||
      binding.stagingId !== stagingId
    ) {
      throw new Error("fixture WAL binding mismatch");
    }
    return binding;
  };
  type V2Manifest = {
    readonly schemaVersion: "2.0";
    readonly identity: {
      readonly kind: "observed_file" | "target";
      readonly rootBindingId: string;
      readonly relativeIdentity: string;
      readonly fileIdentity: string | null;
    };
    readonly sha256: string;
    readonly byteLength: number;
    readonly encoding: "utf-8";
    readonly bom: "none" | "utf-8";
    readonly eol: "none" | "lf" | "crlf" | "mixed";
    readonly metadataChecksum: string;
  };
  type V2Request = {
    readonly schemaVersion: "2.0";
    readonly operationKind: "replace_file" | "create_file";
    readonly contentRootBindingId: string;
    readonly transactionId: string;
    readonly operationId: string;
    readonly providerSemanticVersionSetChecksum: string;
    readonly relativeIdentity: string;
    readonly before:
      | Readonly<{
          readonly schemaVersion: "2.0";
          readonly kind: "present";
          readonly manifest: V2Manifest;
        }>
      | Readonly<{
          readonly schemaVersion: "2.0";
          readonly kind: "absent";
          readonly absenceProof: Record<string, unknown>;
        }>;
    readonly candidate: Readonly<{ readonly schemaVersion: "2.0"; readonly manifest: V2Manifest }>;
    readonly stagingObjectId: string;
  };
  const v2FileIdentity = "win32-file-d0c0b0a0-0000000000000001";
  const v2ParentDirectoryIdentity = "win32-directory-d0c0b0a0-0000000000000001";
  const stableV2 = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stableV2).join(",")}]`;
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableV2(record[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  const v2Hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const v2MetadataChecksum = () => v2Hash("engineering_file_metadata_v2\nattributes=128");
  const v2ByteFields = (bytes: Buffer) => {
    const hasBom =
      bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let sawLf = false;
    let sawCrLf = false;
    let sawBareCr = false;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] === 0x0d) {
        if (index + 1 < bytes.byteLength && bytes[index + 1] === 0x0a) {
          sawCrLf = true;
          index += 1;
        } else {
          sawBareCr = true;
        }
      } else if (bytes[index] === 0x0a) {
        sawLf = true;
      }
    }
    return {
      sha256: v2Hash(bytes),
      byteLength: bytes.byteLength,
      encoding: "utf-8" as const,
      bom: hasBom ? ("utf-8" as const) : ("none" as const),
      eol:
        !sawLf && !sawCrLf && !sawBareCr
          ? ("none" as const)
          : sawCrLf && !sawLf && !sawBareCr
            ? ("crlf" as const)
            : sawLf && !sawCrLf && !sawBareCr
              ? ("lf" as const)
              : ("mixed" as const)
    };
  };
  const sameV2ByteFields = (bytes: Buffer, manifest: V2Manifest) => {
    const actual = v2ByteFields(bytes);
    return (
      actual.sha256 === manifest.sha256 &&
      actual.byteLength === manifest.byteLength &&
      actual.encoding === manifest.encoding &&
      actual.bom === manifest.bom &&
      actual.eol === manifest.eol
    );
  };
  const v2ReceiptFor = (request: V2Request, candidate: Buffer) => {
    const candidateManifest = request.candidate.manifest;
    const after: V2Manifest = {
      schemaVersion: "2.0",
      identity: {
        kind: "observed_file",
        rootBindingId: request.contentRootBindingId,
        relativeIdentity: request.relativeIdentity,
        fileIdentity: v2FileIdentity
      },
      ...v2ByteFields(candidate),
      metadataChecksum: candidateManifest.metadataChecksum
    };
    const unsigned = {
      schemaVersion: "2.0",
      kind: "engineering_mutation_receipt",
      transactionId: request.transactionId,
      operationId: request.operationId,
      operationKind: request.operationKind,
      contentRootBindingId: request.contentRootBindingId,
      providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
      relativeIdentity: request.relativeIdentity,
      requestChecksum: v2Hash(stableV2(request)),
      observedBefore: request.before,
      observedAfter: after,
      stagingObjectId: request.stagingObjectId,
      recoveryObjectId: null,
      durability: "data_and_directory_flushed"
    };
    return { ...unsigned, nativeReceiptChecksum: v2Hash(stableV2(unsigned)) };
  };
  const adapter = {
    paths: [] as string[],
    openWorkspaceRoot(root: string) {
      workspaceRoot = root;
      return {
        rootId: 1n,
        capability: "available",
        rootIdentity: {
          volumeIdentity: "d0c0b0a0",
          directoryIdentity: "0000000000000001",
          canonicalPathIdentityChecksum: "a".repeat(64)
        }
      };
    },
    readFile(rootId: bigint, relativePath: string) {
      adapter.paths.push(relativePath);
      if (
        rootId !== 1n ||
        !workspaceRoot ||
        (relativePath !== "docs/ordinary-utf8.txt" && relativePath !== "docs/created-utf8.txt")
      ) {
        throw new Error("rejected by fixture root-relative reader");
      }
      const bytes = readFileSync(join(workspaceRoot, relativePath));
      return bytes;
    },
    listDirectory(rootId: bigint, relativePath: string) {
      if (rootId !== 1n || relativePath !== "docs") {
        throw new Error("rejected by fixture root-relative lister");
      }
      return [
        {
          name: "ordinary-utf8.txt",
          directory: false,
          byteLength: BigInt(expectedBytes.byteLength)
        }
      ];
    },
    buildIndex(rootId: bigint) {
      if (rootId !== 1n) throw new Error("rejected by fixture root-relative indexer");
      return {
        files: [
          {
            relativePath: "docs/ordinary-utf8.txt",
            byteLength: BigInt(expectedBytes.byteLength)
          }
        ],
        truncated: false
      };
    },
    searchText(rootId: bigint, query: string) {
      if (rootId !== 1n || query !== "needle: deterministic-search") {
        throw new Error("rejected by fixture root-relative searcher");
      }
      return {
        matches: [
          {
            relativePath: "docs/ordinary-utf8.txt",
            byteOffset: BigInt(expectedBytes.indexOf(Buffer.from(query, "utf8")))
          }
        ],
        truncated: false
      };
    },
    closeWorkspaceRoot(rootId: bigint) {
      if (rootId !== 1n) throw new Error("rejected by fixture root closer");
      workspaceRoot = undefined;
      return true;
    },
    mutationV2ProbeInfo() {
      return {
        schemaVersion: "engineering_file_mutation_probe_v1",
        batch: "7",
        status: "available",
        replace: "development_probe_only",
        create: "development_probe_only",
        rawByteBlobs: "available",
        absenceProof: "available",
        absenceProofV2: "available",
        objectMutationAbi: "available",
        targetInspection: "available",
        operationStateReconciliation: "available",
        handleRelativeRevalidation: "available",
        finalRenameNamespaceRevalidation: "available",
        handleBoundReplaceHandoff: "available",
        hardLinkPolicy: "reject_multiple_links",
        copyOnReplace: "not_enabled",
        fixedCreateMetadata: "available",
        receiptDurability: "available",
        stagingWalRecoveryScan: "available",
        stateDurability: "available",
        productCapability: "unavailable"
      };
    },
    mutationV2FaultProbe() {
      return {
        status: "available",
        safety: "invalid_inputs_only_no_protection_switches",
        faultPaths: [
          "raw_byte_manifest_mismatch",
          "stale_absence_proof",
          "wal_binding_mismatch",
          "post_stage_recovery_scan",
          "replace_final_rename_namespace_revalidation",
          "replace_handle_bound_target_swap_no_overwrite",
          "replace_create_only_handoff_collision_recovery",
          "replace_after_original_handoff_recovery",
          "replace_before_candidate_handoff_recovery",
          "replace_after_candidate_handoff_recovery"
        ]
      };
    },
    inspectEngineeringFileSnapshotV2(rootId: bigint, relativePath: string) {
      if (rootId !== 1n || !workspaceRoot) throw new Error("fixture V2 target inspection rejected");
      const target = join(workspaceRoot, relativePath);
      const parentDirectoryIdentity = v2ParentDirectoryIdentity;
      if (!existsSync(target)) {
        return {
          schemaVersion: "2.0",
          kind: "engineering_file_mutation_target_snapshot",
          rootId,
          relativeIdentity: relativePath,
          parentDirectoryIdentity,
          state: "absent",
          bytes: null,
          manifest: null
        };
      }
      const bytes = readFileSync(target);
      return {
        schemaVersion: "2.0",
        kind: "engineering_file_mutation_target_snapshot",
        rootId,
        relativeIdentity: relativePath,
        parentDirectoryIdentity,
        state: "present",
        bytes,
        manifest: {
          ...v2ByteFields(bytes),
          fileIdentity: v2FileIdentity,
          metadataChecksum: v2MetadataChecksum()
        }
      };
    },
    inspectEngineeringFileMutationTargetV2(
      rootId: bigint,
      requestValue: Record<string, unknown>,
      before: Buffer | null,
      candidate: Buffer
    ) {
      const request = requestValue as unknown as V2Request;
      if (rootId !== 1n || !workspaceRoot || request.schemaVersion !== "2.0") {
        throw new Error("fixture V2 recovery inspection rejected");
      }
      const candidateManifest = request.candidate?.manifest;
      if (!candidateManifest || !sameV2ByteFields(candidate, candidateManifest)) {
        throw new Error("fixture V2 recovery candidate rejected");
      }
      const stateFor = (state: "before" | "after" | "neither" | "unknown") => ({
        schemaVersion: "2.0",
        kind: "engineering_mutation_operation_state",
        state,
        requestChecksum: v2Hash(stableV2(request)),
        receipt: state === "after" ? v2ReceiptFor(request, candidate) : null
      });
      const target = join(workspaceRoot, request.relativeIdentity);
      if (!existsSync(target)) {
        return request.operationKind === "create_file" &&
          request.before.kind === "absent" &&
          request.before.absenceProof.parentDirectoryIdentity === v2ParentDirectoryIdentity
          ? stateFor("before")
          : stateFor("neither");
      }
      const observed = readFileSync(target);
      if (
        request.operationKind === "replace_file" &&
        request.before.kind === "present" &&
        before !== null &&
        observed.equals(before) &&
        sameV2ByteFields(before, request.before.manifest) &&
        request.before.manifest.metadataChecksum === v2MetadataChecksum()
      ) {
        return stateFor("before");
      }
      if (
        observed.equals(candidate) &&
        sameV2ByteFields(observed, candidateManifest) &&
        candidateManifest.metadataChecksum === v2MetadataChecksum()
      ) {
        return stateFor("after");
      }
      return stateFor("neither");
    },
    observeCreateAbsenceV2(
      rootId: bigint,
      rootBindingId: string,
      relativePath: string,
      observedAt: string
    ) {
      if (rootId !== 1n || !workspaceRoot || existsSync(join(workspaceRoot, relativePath))) {
        throw new Error("fixture V2 absence proof rejected");
      }
      const unsigned = {
        schemaVersion: "2.0",
        kind: "absence_proof",
        rootBindingId,
        relativeIdentity: relativePath,
        parentDirectoryIdentity: v2ParentDirectoryIdentity,
        observedAt
      };
      return { ...unsigned, absenceProofChecksum: v2Hash(stableV2(unsigned)) };
    },
    applyEngineeringFileMutationV2(
      rootId: bigint,
      requestValue: Record<string, unknown>,
      before: Buffer | null,
      candidate: Buffer
    ) {
      const request = requestValue as unknown as V2Request;
      if (rootId !== 1n || !workspaceRoot || request.schemaVersion !== "2.0") {
        throw new Error("fixture V2 mutation request rejected");
      }
      const target = join(workspaceRoot, request.relativeIdentity);
      const candidateManifest = request.candidate?.manifest;
      if (
        !candidateManifest ||
        !sameV2ByteFields(candidate, candidateManifest) ||
        candidateManifest.metadataChecksum !== v2MetadataChecksum()
      ) {
        throw new Error("fixture V2 candidate precondition rejected");
      }
      if (request.operationKind === "replace_file") {
        if (
          before === null ||
          request.before.kind !== "present" ||
          !existsSync(target) ||
          !readFileSync(target).equals(before) ||
          !sameV2ByteFields(before, request.before.manifest) ||
          request.before.manifest.metadataChecksum !== v2MetadataChecksum()
        ) {
          throw new Error("fixture V2 replace precondition rejected");
        }
      } else if (
        request.operationKind !== "create_file" ||
        before !== null ||
        request.before.kind !== "absent" ||
        existsSync(target)
      ) {
        throw new Error("fixture V2 create precondition rejected");
      }
      writeFileSync(target, candidate);
      const after: V2Manifest = {
        schemaVersion: "2.0",
        identity: {
          kind: "observed_file",
          rootBindingId: request.contentRootBindingId,
          relativeIdentity: request.relativeIdentity,
          fileIdentity: v2FileIdentity
        },
        ...v2ByteFields(candidate),
        metadataChecksum: candidateManifest.metadataChecksum
      };
      const unsigned = {
        schemaVersion: "2.0",
        kind: "engineering_mutation_receipt",
        transactionId: request.transactionId,
        operationId: request.operationId,
        operationKind: request.operationKind,
        contentRootBindingId: request.contentRootBindingId,
        providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
        relativeIdentity: request.relativeIdentity,
        requestChecksum: v2Hash(stableV2(request)),
        observedBefore: request.before,
        observedAfter: after,
        stagingObjectId: request.stagingObjectId,
        recoveryObjectId: null,
        durability: "data_and_directory_flushed"
      };
      return { ...unsigned, nativeReceiptChecksum: v2Hash(stableV2(unsigned)) };
    },
    prepareMutationWalV2(
      rootId: bigint,
      transactionId: string,
      operationId: string,
      stagingId: string,
      version: string
    ) {
      if (rootId !== 1n || version !== "2.0") throw new Error("fixture WAL precondition failed");
      const walBindingId = nextWalBindingId++;
      const checksum = createHash("sha256")
        .update(`${rootId}\n${transactionId}\n${operationId}\n${stagingId}`)
        .digest("hex");
      walBindings.set(walBindingId, { transactionId, operationId, stagingId, checksum });
      return {
        walBindingId,
        bindingChecksum: checksum,
        protocol: "v2_preallocated_binding",
        durabilityRequirement: "caller_must_durable_flush_before_apply"
      };
    },
    observeCreateAbsence(rootId: bigint, parent: string, leaf: string) {
      if (rootId !== 1n || !workspaceRoot || existsSync(join(workspaceRoot, parent, leaf))) {
        throw new Error("fixture absence proof rejected");
      }
      const proofId = nextProofId++;
      absenceProofs.set(proofId, { parent, leaf });
      return { proofId, state: "absent", parentIdentity: identity };
    },
    replaceFileV2(
      rootId: bigint,
      relativePath: string,
      transactionId: string,
      operationId: string,
      stagingId: string,
      walBindingId: bigint,
      before: Buffer,
      beforeManifest: ReturnType<typeof rawManifest>,
      candidate: Buffer,
      candidateManifest: ReturnType<typeof rawManifest>
    ) {
      const binding = walFor(rootId, transactionId, operationId, stagingId, walBindingId);
      const actual = readWorkspaceFile(relativePath);
      if (
        !sameManifest(before, beforeManifest) ||
        !sameManifest(candidate, candidateManifest) ||
        !actual.equals(before) ||
        statSync(join(workspaceRoot ?? "", relativePath)).nlink !== 1
      ) {
        throw new Error("fixture replace precondition rejected");
      }
      writeFileSync(join(workspaceRoot ?? "", relativePath), candidate);
      walBindings.delete(walBindingId);
      return {
        schemaVersion: "engineering_file_mutation_receipt_v1",
        operation: "replace",
        rootId,
        transactionId,
        operationId,
        walBindingChecksum: binding.checksum,
        before: rawManifest(before),
        after: rawManifest(candidate),
        beforeIdentity: identity,
        afterIdentity: identity,
        rootIdentity: identity,
        durability: "data_and_directory_flushed",
        metadataPolicy: "qualified_basic_metadata",
        writeStrategy: "same_directory_staging_rename",
        hardLinkPolicy: "reject_multiple_links"
      };
    },
    createFileV2(
      rootId: bigint,
      parent: string,
      leaf: string,
      proofId: bigint,
      transactionId: string,
      operationId: string,
      stagingId: string,
      walBindingId: bigint,
      candidate: Buffer,
      candidateManifest: ReturnType<typeof rawManifest>
    ) {
      const binding = walFor(rootId, transactionId, operationId, stagingId, walBindingId);
      const proof = absenceProofs.get(proofId);
      const target = join(workspaceRoot ?? "", parent, leaf);
      if (
        !proof ||
        proof.parent !== parent ||
        proof.leaf !== leaf ||
        !sameManifest(candidate, candidateManifest) ||
        existsSync(target)
      ) {
        recoveryRequired = recoveryRequired || existsSync(target);
        throw new Error("fixture create precondition rejected");
      }
      absenceProofs.delete(proofId);
      writeFileSync(target, candidate);
      walBindings.delete(walBindingId);
      return {
        schemaVersion: "engineering_file_mutation_receipt_v1",
        operation: "create",
        rootId,
        transactionId,
        operationId,
        walBindingChecksum: binding.checksum,
        before: null,
        after: rawManifest(candidate),
        beforeIdentity: null,
        afterIdentity: identity,
        rootIdentity: identity,
        durability: "data_and_directory_flushed",
        metadataPolicy: "fixed_windows_metadata",
        writeStrategy: "same_directory_staging_rename",
        hardLinkPolicy: "reject_multiple_links"
      };
    },
    scanMutationRecovery(rootId: bigint) {
      if (rootId !== 1n || !workspaceRoot) throw new Error("fixture recovery root rejected");
      const stagingCount = [
        ".novel-studio-stage-probe-orphan",
        ".novel-studio-stage-probe-after-original-handoff",
        ".novel-studio-stage-probe-before-candidate-handoff",
        ".novel-studio-stage-probe-after-candidate-handoff"
      ].filter((name) => existsSync(join(workspaceRoot, "docs", name))).length;
      return {
        state: recoveryRequired || stagingCount !== 0 ? "recovery_required" : "clear",
        pendingStagingCount: BigInt(stagingCount),
        inProcessPendingWalCount: 0n,
        scanTruncated: false,
        scanScope: "native_staging_and_in_process_wal_only",
        durableWalRequirement: "external_durable_wal_scan_required"
      };
    }
  };
  return adapter;
}

function normalizeProbeFixture(value: string): string {
  return value.replace(/\r\n/gu, "\n");
}
