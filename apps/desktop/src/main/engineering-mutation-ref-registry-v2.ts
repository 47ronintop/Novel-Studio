import { randomBytes } from "node:crypto";

import { validateEngineeringRelativePath } from "@novel-studio/agent-engine";

export const ENGINEERING_MUTATION_FILE_REF_PREFIX = "engineering_file_ref:" as const;
export const ENGINEERING_MUTATION_DIRECTORY_REF_PREFIX = "engineering_directory_ref:" as const;

export type EngineeringMutationRefKindV2 = "file" | "directory";

export type EngineeringMutationOpaqueRefV2 =
  | `${typeof ENGINEERING_MUTATION_FILE_REF_PREFIX}${string}`
  | `${typeof ENGINEERING_MUTATION_DIRECTORY_REF_PREFIX}${string}`;

/** The only renderer/provider-safe projection. It deliberately contains no path or root metadata. */
export interface EngineeringMutationRefProjectionV2 {
  readonly opaqueRef: EngineeringMutationOpaqueRefV2;
}

/** Main-only facts required to mint an opaque native/source reference. */
export interface EngineeringMutationRefIssueV2 {
  readonly kind: EngineeringMutationRefKindV2;
  readonly rootBindingId: string;
  readonly pathPolicyRevision: string;
  readonly relativeIdentity: string;
  /** SHA-256 of the qualified native/source reference evidence. */
  readonly sourceNativeRefChecksum: string;
  readonly issuedCapabilityRevision: string;
}

/** Main-only resolved binding. This is never a renderer/provider projection. */
export interface EngineeringMutationRefBindingV2 extends EngineeringMutationRefIssueV2 {
  readonly opaqueRef: EngineeringMutationOpaqueRefV2;
}

/** Every expected value must match the original Main-owned issuance exactly. */
export interface EngineeringMutationRefResolveInputV2 {
  readonly opaqueRef: EngineeringMutationOpaqueRefV2;
  readonly expectedKind: EngineeringMutationRefKindV2;
  readonly expectedRootBindingId: string;
  readonly expectedPathPolicyRevision: string;
  readonly expectedSourceNativeRefChecksum: string;
  readonly expectedCapabilityRevision: string;
}

/**
 * Main-only lookup used before a fresh native re-read. The stored source checksum is returned and
 * must then be compared with that fresh native snapshot; omitting it here never makes it optional
 * at the mutation boundary.
 */
export interface EngineeringMutationRefCurrentBoundaryInputV2 {
  readonly opaqueRef: EngineeringMutationOpaqueRefV2;
  readonly expectedKind: EngineeringMutationRefKindV2;
  readonly expectedRootBindingId: string;
  readonly expectedPathPolicyRevision: string;
  readonly expectedCapabilityRevision: string;
}

export interface EngineeringMutationRefRegistryV2 {
  issue(input: unknown): EngineeringMutationRefProjectionV2 | undefined;
  resolve(input: unknown): EngineeringMutationRefBindingV2 | undefined;
  resolveCurrentBoundary(input: unknown): EngineeringMutationRefBindingV2 | undefined;
  /** Removes every issued reference for this exact root binding. */
  revokeRootBinding(rootBindingId: string): void;
  /** Drops all references, for process shutdown or a full Main-owned capability reset. */
  clear(): void;
}

/**
 * Main-only registry for opaque Engineering mutation references. It retains the capability/root/path
 * binding in memory and exposes only a cryptographically unpredictable reference outside Main.
 */
export function createEngineeringMutationRefRegistryV2(): EngineeringMutationRefRegistryV2 {
  const bindings = new Map<EngineeringMutationOpaqueRefV2, EngineeringMutationRefBindingV2>();

  function issue(input: unknown): EngineeringMutationRefProjectionV2 | undefined {
    const candidate = parseIssueInput(input);
    if (candidate === undefined) return undefined;

    const opaqueRef = nextOpaqueRef(candidate.kind, bindings);
    const binding = Object.freeze({ ...candidate, opaqueRef });
    bindings.set(opaqueRef, binding);
    return Object.freeze({ opaqueRef });
  }

  function resolve(input: unknown): EngineeringMutationRefBindingV2 | undefined {
    const expected = parseResolveInput(input);
    if (expected === undefined) return undefined;

    const binding = bindings.get(expected.opaqueRef);
    if (
      binding === undefined ||
      binding.opaqueRef !== expected.opaqueRef ||
      binding.kind !== expected.expectedKind ||
      binding.rootBindingId !== expected.expectedRootBindingId ||
      binding.pathPolicyRevision !== expected.expectedPathPolicyRevision ||
      binding.sourceNativeRefChecksum !== expected.expectedSourceNativeRefChecksum ||
      binding.issuedCapabilityRevision !== expected.expectedCapabilityRevision
    ) {
      return undefined;
    }
    return binding;
  }

  function resolveCurrentBoundary(input: unknown): EngineeringMutationRefBindingV2 | undefined {
    const expected = parseCurrentBoundaryInput(input);
    if (expected === undefined) return undefined;
    const binding = bindings.get(expected.opaqueRef);
    if (
      binding === undefined ||
      binding.opaqueRef !== expected.opaqueRef ||
      binding.kind !== expected.expectedKind ||
      binding.rootBindingId !== expected.expectedRootBindingId ||
      binding.pathPolicyRevision !== expected.expectedPathPolicyRevision ||
      binding.issuedCapabilityRevision !== expected.expectedCapabilityRevision
    ) {
      return undefined;
    }
    return binding;
  }

  function revokeRootBinding(rootBindingId: string): void {
    if (!isOpaqueIdentity(rootBindingId)) return;
    for (const [opaqueRef, binding] of bindings) {
      if (binding.rootBindingId === rootBindingId) bindings.delete(opaqueRef);
    }
  }

  function clear(): void {
    bindings.clear();
  }

  return Object.freeze({ issue, resolve, resolveCurrentBoundary, revokeRootBinding, clear });
}

function parseIssueInput(value: unknown): EngineeringMutationRefIssueV2 | undefined {
  if (!hasExactKeys(value, issueKeys)) return undefined;
  const relativeIdentity =
    value["kind"] === "directory" && value["relativeIdentity"] === ""
      ? ""
      : validateEngineeringRelativePath(value["relativeIdentity"]);
  if (
    !isKind(value["kind"]) ||
    !isOpaqueIdentity(value["rootBindingId"]) ||
    !isOpaqueIdentity(value["pathPolicyRevision"]) ||
    (typeof relativeIdentity !== "string" && !relativeIdentity.ok) ||
    !isSha256(value["sourceNativeRefChecksum"]) ||
    !isOpaqueIdentity(value["issuedCapabilityRevision"])
  ) {
    return undefined;
  }
  return Object.freeze({
    kind: value["kind"],
    rootBindingId: value["rootBindingId"],
    pathPolicyRevision: value["pathPolicyRevision"],
    relativeIdentity:
      typeof relativeIdentity === "string" ? relativeIdentity : relativeIdentity.relativeIdentity,
    sourceNativeRefChecksum: value["sourceNativeRefChecksum"],
    issuedCapabilityRevision: value["issuedCapabilityRevision"]
  });
}

function parseResolveInput(value: unknown): EngineeringMutationRefResolveInputV2 | undefined {
  if (!hasExactKeys(value, resolveKeys)) return undefined;
  if (
    !isOpaqueRef(value["opaqueRef"]) ||
    !isKind(value["expectedKind"]) ||
    !isOpaqueIdentity(value["expectedRootBindingId"]) ||
    !isOpaqueIdentity(value["expectedPathPolicyRevision"]) ||
    !isSha256(value["expectedSourceNativeRefChecksum"]) ||
    !isOpaqueIdentity(value["expectedCapabilityRevision"])
  ) {
    return undefined;
  }
  return Object.freeze({
    opaqueRef: value["opaqueRef"],
    expectedKind: value["expectedKind"],
    expectedRootBindingId: value["expectedRootBindingId"],
    expectedPathPolicyRevision: value["expectedPathPolicyRevision"],
    expectedSourceNativeRefChecksum: value["expectedSourceNativeRefChecksum"],
    expectedCapabilityRevision: value["expectedCapabilityRevision"]
  });
}

function parseCurrentBoundaryInput(
  value: unknown
): EngineeringMutationRefCurrentBoundaryInputV2 | undefined {
  if (!hasExactKeys(value, currentBoundaryKeys)) return undefined;
  if (
    !isOpaqueRef(value["opaqueRef"]) ||
    !isKind(value["expectedKind"]) ||
    !isOpaqueIdentity(value["expectedRootBindingId"]) ||
    !isOpaqueIdentity(value["expectedPathPolicyRevision"]) ||
    !isOpaqueIdentity(value["expectedCapabilityRevision"])
  ) {
    return undefined;
  }
  return Object.freeze({
    opaqueRef: value["opaqueRef"],
    expectedKind: value["expectedKind"],
    expectedRootBindingId: value["expectedRootBindingId"],
    expectedPathPolicyRevision: value["expectedPathPolicyRevision"],
    expectedCapabilityRevision: value["expectedCapabilityRevision"]
  });
}

function nextOpaqueRef(
  kind: EngineeringMutationRefKindV2,
  bindings: ReadonlyMap<EngineeringMutationOpaqueRefV2, EngineeringMutationRefBindingV2>
): EngineeringMutationOpaqueRefV2 {
  const prefix =
    kind === "file"
      ? ENGINEERING_MUTATION_FILE_REF_PREFIX
      : ENGINEERING_MUTATION_DIRECTORY_REF_PREFIX;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const opaqueRef =
      `${prefix}${randomBytes(32).toString("hex")}` as EngineeringMutationOpaqueRefV2;
    if (!bindings.has(opaqueRef)) return opaqueRef;
  }
  throw new Error("ENGINEERING_MUTATION_REF_ENTROPY_UNAVAILABLE");
}

function isKind(value: unknown): value is EngineeringMutationRefKindV2 {
  return value === "file" || value === "directory";
}

function isOpaqueRef(value: unknown): value is EngineeringMutationOpaqueRefV2 {
  return (
    typeof value === "string" &&
    /^(?:engineering_file_ref|engineering_directory_ref):[a-f0-9]{64}$/u.test(value)
  );
}

function isOpaqueIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.normalize("NFC") === value &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f
    )
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

const issueKeys = [
  "issuedCapabilityRevision",
  "kind",
  "pathPolicyRevision",
  "relativeIdentity",
  "rootBindingId",
  "sourceNativeRefChecksum"
] as const;

const resolveKeys = [
  "expectedCapabilityRevision",
  "expectedKind",
  "expectedPathPolicyRevision",
  "expectedRootBindingId",
  "expectedSourceNativeRefChecksum",
  "opaqueRef"
] as const;

const currentBoundaryKeys = [
  "expectedCapabilityRevision",
  "expectedKind",
  "expectedPathPolicyRevision",
  "expectedRootBindingId",
  "opaqueRef"
] as const;
