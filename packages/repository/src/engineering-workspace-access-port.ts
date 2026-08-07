import { createHash } from "node:crypto";

import {
  classifyEngineeringPath,
  type EngineeringPathPolicy,
  type EngineeringWorkspaceRootBindingV1
} from "@novel-studio/agent-engine";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError, validationError } from "./errors.js";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_LIST_ENTRIES = 10_000;
const MAX_INDEX_ENTRIES = 10_000;
const MAX_SEARCH_RESULTS = 1_000;
const MAX_QUERY_BYTES = 1_024;

/**
 * The entire B6 ABI surface accepted by the repository. Mutation, recovery, and directory
 * creation are deliberately absent: adding an export to the native module is not an authority to
 * expose it through this port.
 */
export interface EngineeringWorkspaceAccessNativeAddon {
  openWorkspaceRoot(rootPath: string): unknown;
  closeWorkspaceRoot(rootId: bigint): unknown;
  listDirectory(rootId: bigint, relativePath?: string): unknown;
  readFile(rootId: bigint, relativePath: string): unknown;
  searchText(rootId: bigint, query: string): unknown;
  buildIndex(rootId: bigint): unknown;
}

/**
 * Identity returned by the already-verified native root handle. It intentionally contains no
 * pathname: only Main uses it to issue a root binding before a session becomes usable.
 */
export interface EngineeringWorkspaceNativeRootIdentity {
  readonly volumeIdentity: string;
  readonly directoryIdentity: string;
  readonly canonicalPathIdentityChecksum: string;
}

export type EngineeringWorkspaceRootBindingIssuer = (
  nativeIdentity: EngineeringWorkspaceNativeRootIdentity
) => unknown;

export interface EngineeringWorkspaceAccessPortOptions {
  readonly addon: unknown;
  readonly traceId?: string;
}

export type EngineeringWorkspaceAccessOpenRequest =
  | {
      /** Main-owned filesystem path; it is never returned or included in an error. */
      readonly rootPath: string;
      /** A previously Main-issued binding, revalidated against this native handle. */
      readonly rootBinding: EngineeringWorkspaceRootBindingV1;
      readonly pathPolicy: EngineeringPathPolicy;
    }
  | {
      /** Main-owned filesystem path; it is never returned or included in an error. */
      readonly rootPath: string;
      /** Main-owned issuer called only after native has verified the root handle. */
      readonly issueRootBinding: EngineeringWorkspaceRootBindingIssuer;
      readonly pathPolicy: EngineeringPathPolicy;
    };

export interface EngineeringWorkspaceAccessBinding {
  readonly rootBindingId: string;
  readonly pathPolicyRevision: string;
}

export interface EngineeringWorkspaceAccessDirectoryEntry {
  readonly name: string;
  readonly relativeIdentity: string;
  readonly kind: "directory" | "file";
  readonly byteLength: number;
  readonly binding: EngineeringWorkspaceAccessBinding;
  readonly refChecksum: string;
}

export interface EngineeringWorkspaceAccessTextSnapshot {
  readonly relativeIdentity: string;
  readonly content: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly encoding: "utf-8";
  readonly bom: "none" | "utf-8";
  readonly binding: EngineeringWorkspaceAccessBinding;
  readonly refChecksum: string;
}

export interface EngineeringWorkspaceAccessSearchMatch {
  readonly relativeIdentity: string;
  readonly byteOffset: number;
  readonly binding: EngineeringWorkspaceAccessBinding;
  readonly refChecksum: string;
}

export interface EngineeringWorkspaceAccessIndexEntry {
  readonly relativeIdentity: string;
  readonly byteLength: number;
  readonly binding: EngineeringWorkspaceAccessBinding;
  readonly refChecksum: string;
}

export interface EngineeringWorkspaceAccessSession {
  readonly binding: EngineeringWorkspaceAccessBinding;
  listDirectory(
    input?: unknown
  ): Promise<
    Result<
      Readonly<{ readonly entries: readonly EngineeringWorkspaceAccessDirectoryEntry[] }>,
      UnifiedError
    >
  >;
  readTextFile(
    input: unknown
  ): Promise<Result<EngineeringWorkspaceAccessTextSnapshot, UnifiedError>>;
  searchText(input: unknown): Promise<
    Result<
      Readonly<{
        readonly matches: readonly EngineeringWorkspaceAccessSearchMatch[];
        readonly truncated: boolean;
      }>,
      UnifiedError
    >
  >;
  buildIndex(): Promise<
    Result<
      Readonly<{
        readonly files: readonly EngineeringWorkspaceAccessIndexEntry[];
        readonly truncated: boolean;
      }>,
      UnifiedError
    >
  >;
  close(): Promise<Result<Readonly<{ readonly closed: boolean }>, UnifiedError>>;
}

export interface EngineeringWorkspaceAccessPort {
  open(input: unknown): Promise<Result<EngineeringWorkspaceAccessSession, UnifiedError>>;
}

/**
 * Creates the TypeScript-facing B6 access port for the one ADR-0003 Node-API addon. Main may
 * inject the loaded addon here later; this module never loads a native host or falls back to
 * pathname APIs.
 */
export function createEngineeringWorkspaceAccessPort(
  options: EngineeringWorkspaceAccessPortOptions
): EngineeringWorkspaceAccessPort {
  const traceId = options.traceId ?? "engineering-workspace-access-port";
  const addon = parseAddon(options.addon);

  return Object.freeze({
    async open(input: unknown): Promise<Result<EngineeringWorkspaceAccessSession, UnifiedError>> {
      const parsed = parseOpenRequest(input);
      if (!parsed.ok) return inputRejected(traceId);
      if (addon === undefined) return unavailable(traceId);

      let nativeRoot: unknown;
      try {
        nativeRoot = addon.openWorkspaceRoot(parsed.value.rootPath);
      } catch (cause) {
        return nativeFailure(cause, traceId);
      }
      const openedRoot = parseOpenedRoot(nativeRoot);
      if (openedRoot === undefined) return protocolFailure(traceId);
      const rootBinding = resolveRootBinding(parsed.value, openedRoot.rootIdentity);
      if (rootBinding === undefined) {
        closeOpenedRoot(addon, openedRoot.rootId);
        return inputRejected(traceId);
      }

      const binding = Object.freeze({
        rootBindingId: rootBinding.rootBindingId,
        pathPolicyRevision: rootBinding.pathPolicyRevision
      });
      return ok(
        new NativeEngineeringWorkspaceAccessSession({
          addon,
          rootId: openedRoot.rootId,
          binding,
          pathPolicy: parsed.value.pathPolicy,
          traceId
        })
      );
    }
  });
}

class NativeEngineeringWorkspaceAccessSession implements EngineeringWorkspaceAccessSession {
  public readonly binding: EngineeringWorkspaceAccessBinding;
  private closed = false;

  public constructor(
    private readonly options: {
      readonly addon: EngineeringWorkspaceAccessNativeAddon;
      readonly rootId: bigint;
      readonly binding: EngineeringWorkspaceAccessBinding;
      readonly pathPolicy: EngineeringPathPolicy;
      readonly traceId: string;
    }
  ) {
    this.binding = options.binding;
  }

  public async listDirectory(
    input: unknown = undefined
  ): Promise<
    Result<
      Readonly<{ readonly entries: readonly EngineeringWorkspaceAccessDirectoryEntry[] }>,
      UnifiedError
    >
  > {
    if (this.closed) return unavailable(this.options.traceId);
    const relativePath = parseOptionalRelativePath(input, this.options.pathPolicy);
    if (relativePath === undefined && input !== undefined)
      return inputRejected(this.options.traceId);

    let value: unknown;
    try {
      // The Node-API ABI distinguishes a one-argument root listing from a two-argument
      // subdirectory listing. Passing JavaScript `undefined` as the second value would still
      // be observed as argc=2 and be rejected by the native UTF-16 argument parser.
      value =
        relativePath === undefined
          ? this.options.addon.listDirectory(this.options.rootId)
          : this.options.addon.listDirectory(this.options.rootId, relativePath);
    } catch (cause) {
      return nativeFailure(cause, this.options.traceId);
    }
    const parsed = parseDirectoryEntries(value, relativePath ?? "", this.options);
    return parsed === undefined
      ? protocolFailure(this.options.traceId)
      : ok(Object.freeze({ entries: parsed }));
  }

  public async readTextFile(
    input: unknown
  ): Promise<Result<EngineeringWorkspaceAccessTextSnapshot, UnifiedError>> {
    if (this.closed) return unavailable(this.options.traceId);
    const relativeIdentity = parseRequiredRelativePath(input, this.options.pathPolicy);
    if (relativeIdentity === undefined) return inputRejected(this.options.traceId);

    let value: unknown;
    try {
      value = this.options.addon.readFile(this.options.rootId, relativeIdentity);
    } catch (cause) {
      return nativeFailure(cause, this.options.traceId);
    }
    const bytes = parseTextBytes(value);
    if (bytes === undefined) return protocolFailure(this.options.traceId);

    const bom = hasUtf8Bom(bytes) ? "utf-8" : "none";
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return protocolFailure(this.options.traceId);
    }
    if (content.includes("\0")) return protocolFailure(this.options.traceId);

    const byteLength = bytes.byteLength;
    const sha256 = sha256Hex(bytes);
    const binding = this.options.binding;
    return ok(
      Object.freeze({
        relativeIdentity,
        content,
        byteLength,
        sha256,
        encoding: "utf-8" as const,
        bom,
        binding,
        refChecksum: referenceChecksum({
          kind: "text_snapshot",
          binding,
          relativeIdentity,
          byteLength,
          sha256
        })
      })
    );
  }

  public async searchText(input: unknown): Promise<
    Result<
      Readonly<{
        readonly matches: readonly EngineeringWorkspaceAccessSearchMatch[];
        readonly truncated: boolean;
      }>,
      UnifiedError
    >
  > {
    if (this.closed) return unavailable(this.options.traceId);
    const query = parseSearchQuery(input);
    if (query === undefined) return inputRejected(this.options.traceId);

    let value: unknown;
    try {
      value = this.options.addon.searchText(this.options.rootId, query);
    } catch (cause) {
      return nativeFailure(cause, this.options.traceId);
    }
    const parsed = parseSearchResult(value, this.options);
    return parsed === undefined ? protocolFailure(this.options.traceId) : ok(parsed);
  }

  public async buildIndex(): Promise<
    Result<
      Readonly<{
        readonly files: readonly EngineeringWorkspaceAccessIndexEntry[];
        readonly truncated: boolean;
      }>,
      UnifiedError
    >
  > {
    if (this.closed) return unavailable(this.options.traceId);
    let value: unknown;
    try {
      value = this.options.addon.buildIndex(this.options.rootId);
    } catch (cause) {
      return nativeFailure(cause, this.options.traceId);
    }
    const parsed = parseIndexResult(value, this.options);
    return parsed === undefined ? protocolFailure(this.options.traceId) : ok(parsed);
  }

  public async close(): Promise<Result<Readonly<{ readonly closed: boolean }>, UnifiedError>> {
    if (this.closed) return ok(Object.freeze({ closed: false }));
    let value: unknown;
    try {
      value = this.options.addon.closeWorkspaceRoot(this.options.rootId);
    } catch (cause) {
      return nativeFailure(cause, this.options.traceId);
    }
    if (typeof value !== "boolean") return protocolFailure(this.options.traceId);
    this.closed = true;
    return ok(Object.freeze({ closed: value }));
  }
}

function parseAddon(value: unknown): EngineeringWorkspaceAccessNativeAddon | undefined {
  if (!isRecord(value)) return undefined;
  const names = [
    "openWorkspaceRoot",
    "closeWorkspaceRoot",
    "listDirectory",
    "readFile",
    "searchText",
    "buildIndex"
  ] as const;
  return names.every((name) => typeof value[name] === "function")
    ? (value as unknown as EngineeringWorkspaceAccessNativeAddon)
    : undefined;
}

function parseOpenRequest(value: unknown):
  | {
      readonly ok: true;
      readonly value: {
        readonly rootPath: string;
        readonly pathPolicy: EngineeringPathPolicy;
        readonly rootBinding?: EngineeringWorkspaceRootBindingV1;
        readonly issueRootBinding?: EngineeringWorkspaceRootBindingIssuer;
      };
    }
  | { readonly ok: false } {
  if (
    !isRecord(value) ||
    !isSafeRootPath(value["rootPath"]) ||
    !isPathPolicy(value["pathPolicy"])
  ) {
    return { ok: false };
  }
  if (
    hasExactKeys(value, ["pathPolicy", "rootBinding", "rootPath"]) &&
    isRootBinding(value["rootBinding"])
  ) {
    return {
      ok: true,
      value: {
        rootPath: value["rootPath"],
        rootBinding: value["rootBinding"],
        pathPolicy: value["pathPolicy"]
      }
    };
  }
  if (
    hasExactKeys(value, ["issueRootBinding", "pathPolicy", "rootPath"]) &&
    typeof value["issueRootBinding"] === "function"
  ) {
    return {
      ok: true,
      value: {
        rootPath: value["rootPath"],
        issueRootBinding: value["issueRootBinding"] as EngineeringWorkspaceRootBindingIssuer,
        pathPolicy: value["pathPolicy"]
      }
    };
  }
  return { ok: false };
}

function parseOpenedRoot(
  value: unknown
):
  | { readonly rootId: bigint; readonly rootIdentity: EngineeringWorkspaceNativeRootIdentity }
  | undefined {
  if (
    !hasExactKeys(value, ["capability", "rootId", "rootIdentity"]) ||
    value["capability"] !== "available" ||
    typeof value["rootId"] !== "bigint" ||
    value["rootId"] <= 0n ||
    !isNativeRootIdentity(value["rootIdentity"])
  ) {
    return undefined;
  }
  return Object.freeze({ rootId: value["rootId"], rootIdentity: value["rootIdentity"] });
}

function resolveRootBinding(
  request: {
    readonly rootBinding?: EngineeringWorkspaceRootBindingV1;
    readonly issueRootBinding?: EngineeringWorkspaceRootBindingIssuer;
  },
  nativeIdentity: EngineeringWorkspaceNativeRootIdentity
): EngineeringWorkspaceRootBindingV1 | undefined {
  let binding: unknown;
  try {
    binding = request.rootBinding ?? request.issueRootBinding?.(nativeIdentity);
  } catch {
    return undefined;
  }
  return isRootBinding(binding) && rootBindingMatchesNativeIdentity(binding, nativeIdentity)
    ? binding
    : undefined;
}

function closeOpenedRoot(addon: EngineeringWorkspaceAccessNativeAddon, rootId: bigint): void {
  try {
    addon.closeWorkspaceRoot(rootId);
  } catch {
    // A rejected binding must not become an observable native error or a leaked root session.
  }
}

function isNativeRootIdentity(value: unknown): value is EngineeringWorkspaceNativeRootIdentity {
  return (
    hasExactKeys(value, ["canonicalPathIdentityChecksum", "directoryIdentity", "volumeIdentity"]) &&
    typeof value["volumeIdentity"] === "string" &&
    /^[0-9a-f]{8}$/u.test(value["volumeIdentity"]) &&
    typeof value["directoryIdentity"] === "string" &&
    /^[0-9a-f]{16}$/u.test(value["directoryIdentity"]) &&
    isSha256(value["canonicalPathIdentityChecksum"])
  );
}

function rootBindingMatchesNativeIdentity(
  binding: EngineeringWorkspaceRootBindingV1,
  nativeIdentity: EngineeringWorkspaceNativeRootIdentity
): boolean {
  return (
    binding.volumeIdentity === nativeIdentity.volumeIdentity &&
    binding.directoryIdentity === nativeIdentity.directoryIdentity &&
    binding.canonicalPathIdentityChecksum === nativeIdentity.canonicalPathIdentityChecksum
  );
}

function parseOptionalRelativePath(
  value: unknown,
  pathPolicy: EngineeringPathPolicy
): string | undefined {
  if (value === undefined) return undefined;
  if (!hasExactKeys(value, ["relativeIdentity"])) return undefined;
  return classifyAllowedPath(value["relativeIdentity"], pathPolicy);
}

function parseRequiredRelativePath(
  value: unknown,
  pathPolicy: EngineeringPathPolicy
): string | undefined {
  if (!hasExactKeys(value, ["relativeIdentity"])) return undefined;
  return classifyAllowedPath(value["relativeIdentity"], pathPolicy);
}

function classifyAllowedPath(
  value: unknown,
  pathPolicy: EngineeringPathPolicy
): string | undefined {
  const classified = classifyEngineeringPath(value, pathPolicy);
  return classified.ok &&
    (classified.classification === "ordinary" || classified.classification === "policy_managed")
    ? classified.relativeIdentity
    : undefined;
}

function parseDirectoryEntries(
  value: unknown,
  parent: string,
  options: NativeEngineeringWorkspaceAccessSession["options"]
): readonly EngineeringWorkspaceAccessDirectoryEntry[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST_ENTRIES) return undefined;
  const output: EngineeringWorkspaceAccessDirectoryEntry[] = [];
  for (const entry of value) {
    if (!hasExactKeys(entry, ["byteLength", "directory", "name"])) return undefined;
    if (typeof entry["name"] !== "string" || typeof entry["directory"] !== "boolean")
      return undefined;
    const byteLength = parseByteLength(entry["byteLength"]);
    if (byteLength === undefined) return undefined;
    const relativeIdentity = parent.length === 0 ? entry["name"] : `${parent}/${entry["name"]}`;
    const classified = classifyEngineeringPath(relativeIdentity, options.pathPolicy);
    if (!classified.ok || classified.classification === "hard_denied") return undefined;
    if (classified.classification === "ignored_generated") continue;
    const binding = options.binding;
    output.push(
      Object.freeze({
        name: entry["name"],
        relativeIdentity: classified.relativeIdentity,
        kind: entry["directory"] ? "directory" : "file",
        byteLength,
        binding,
        refChecksum: referenceChecksum({
          kind: "directory_entry",
          binding,
          relativeIdentity: classified.relativeIdentity,
          byteLength,
          directory: entry["directory"]
        })
      })
    );
  }
  return Object.freeze(output);
}

function parseTextBytes(value: unknown): Uint8Array | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_TEXT_BYTES) return undefined;
  return value;
}

function parseSearchQuery(value: unknown): string | undefined {
  if (!hasExactKeys(value, ["query"]) || typeof value["query"] !== "string") return undefined;
  const query = value["query"];
  return query.length > 0 &&
    isWellFormedUnicode(query) &&
    !query.includes("\0") &&
    new TextEncoder().encode(query).byteLength <= MAX_QUERY_BYTES
    ? query
    : undefined;
}

function parseSearchResult(
  value: unknown,
  options: NativeEngineeringWorkspaceAccessSession["options"]
):
  | Readonly<{
      readonly matches: readonly EngineeringWorkspaceAccessSearchMatch[];
      readonly truncated: boolean;
    }>
  | undefined {
  if (
    !hasExactKeys(value, ["matches", "truncated"]) ||
    !Array.isArray(value["matches"]) ||
    value["matches"].length > MAX_SEARCH_RESULTS ||
    typeof value["truncated"] !== "boolean"
  ) {
    return undefined;
  }
  const matches: EngineeringWorkspaceAccessSearchMatch[] = [];
  for (const match of value["matches"]) {
    if (
      !hasExactKeys(match, ["byteOffset", "relativePath"]) ||
      typeof match["relativePath"] !== "string"
    ) {
      return undefined;
    }
    const byteOffset = parseByteLength(match["byteOffset"]);
    const relativeIdentity = classifyAllowedPath(match["relativePath"], options.pathPolicy);
    if (byteOffset === undefined) return undefined;
    if (relativeIdentity === undefined) {
      const classified = classifyEngineeringPath(match["relativePath"], options.pathPolicy);
      if (!classified.ok || classified.classification === "hard_denied") return undefined;
      continue;
    }
    const binding = options.binding;
    matches.push(
      Object.freeze({
        relativeIdentity,
        byteOffset,
        binding,
        refChecksum: referenceChecksum({
          kind: "search_match",
          binding,
          relativeIdentity,
          byteOffset
        })
      })
    );
  }
  return Object.freeze({ matches: Object.freeze(matches), truncated: value["truncated"] });
}

function parseIndexResult(
  value: unknown,
  options: NativeEngineeringWorkspaceAccessSession["options"]
):
  | Readonly<{
      readonly files: readonly EngineeringWorkspaceAccessIndexEntry[];
      readonly truncated: boolean;
    }>
  | undefined {
  if (
    !hasExactKeys(value, ["files", "truncated"]) ||
    !Array.isArray(value["files"]) ||
    value["files"].length > MAX_INDEX_ENTRIES ||
    typeof value["truncated"] !== "boolean"
  ) {
    return undefined;
  }
  const files: EngineeringWorkspaceAccessIndexEntry[] = [];
  for (const file of value["files"]) {
    if (
      !hasExactKeys(file, ["byteLength", "relativePath"]) ||
      typeof file["relativePath"] !== "string"
    ) {
      return undefined;
    }
    const byteLength = parseByteLength(file["byteLength"]);
    const relativeIdentity = classifyAllowedPath(file["relativePath"], options.pathPolicy);
    if (byteLength === undefined) return undefined;
    if (relativeIdentity === undefined) {
      const classified = classifyEngineeringPath(file["relativePath"], options.pathPolicy);
      if (!classified.ok || classified.classification === "hard_denied") return undefined;
      continue;
    }
    const binding = options.binding;
    files.push(
      Object.freeze({
        relativeIdentity,
        byteLength,
        binding,
        refChecksum: referenceChecksum({
          kind: "index_entry",
          binding,
          relativeIdentity,
          byteLength
        })
      })
    );
  }
  return Object.freeze({ files: Object.freeze(files), truncated: value["truncated"] });
}

function parseByteLength(value: unknown): number | undefined {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    return undefined;
  return Number(value);
}

function isRootBinding(value: unknown): value is EngineeringWorkspaceRootBindingV1 {
  if (!hasExactKeys(value, rootBindingKeys)) return false;
  return (
    value["schemaVersion"] === "1.0" &&
    value["workspaceKind"] === "engineeringWorkspace" &&
    nonEmptyString(value["rootBindingId"]) &&
    nonEmptyString(value["workspaceId"]) &&
    nonEmptyString(value["volumeIdentity"]) &&
    nonEmptyString(value["directoryIdentity"]) &&
    isSha256(value["canonicalPathIdentityChecksum"]) &&
    nonEmptyString(value["pathPolicyRevision"]) &&
    isCanonicalUtcTimestamp(value["issuedAt"])
  );
}

const rootBindingKeys = [
  "canonicalPathIdentityChecksum",
  "directoryIdentity",
  "issuedAt",
  "pathPolicyRevision",
  "rootBindingId",
  "schemaVersion",
  "volumeIdentity",
  "workspaceId",
  "workspaceKind"
] as const;

function isPathPolicy(value: unknown): value is EngineeringPathPolicy {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "ignoredRelativeIdentityKeys",
      "ignoredRootKeys",
      "policyManagedLeafKeys"
    ]) &&
    value["ignoredRelativeIdentityKeys"] instanceof Set &&
    value["ignoredRootKeys"] instanceof Set &&
    value["policyManagedLeafKeys"] instanceof Set
  );
}

function isSafeRootPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    isWellFormedUnicode(value) &&
    !value.includes("\0")
  );
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function referenceChecksum(value: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/iu.test(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function inputRejected(traceId: string): Result<never, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_WORKSPACE_ACCESS_INPUT_REJECTED",
      message: "The engineering workspace access request is invalid.",
      suggestedAction: "Use a Main-issued root binding and canonical workspace-relative input.",
      traceId
    })
  );
}

function protocolFailure(traceId: string): Result<never, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WORKSPACE_ACCESS_NATIVE_PROTOCOL_INVALID",
      message: "The engineering workspace access service returned an invalid response.",
      suggestedAction: "Reload the workspace before trying again.",
      traceId
    })
  );
}

function unavailable(traceId: string): Result<never, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE",
      message: "The engineering workspace access service is unavailable.",
      suggestedAction: "Reload the workspace before trying again.",
      traceId
    })
  );
}

function nativeFailure(cause: unknown, traceId: string): Result<never, UnifiedError> {
  const code = nativeErrorCode(cause);
  if (code === "ENGINEERING_ACCESS_ROOT_CHANGED") {
    return err(
      storageError({
        code: "ENGINEERING_WORKSPACE_ACCESS_ROOT_CHANGED",
        message: "The engineering workspace root changed while it was being accessed.",
        suggestedAction: "Reopen the workspace before trying again.",
        traceId
      })
    );
  }
  return unavailable(traceId);
}

function nativeErrorCode(cause: unknown): string | undefined {
  return isRecord(cause) && typeof cause["code"] === "string" ? cause["code"] : undefined;
}
