/**
 * Main-only persistence for whether project-authored conventions may influence an Agent run.
 * A policy is bound to the canonical workspace root and its filesystem identity, so moving or
 * replacing a workspace cannot inherit a prior trust decision. Missing or malformed state
 * intentionally fails closed.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  validateAgentRelativePath,
  type AgentContextRange,
  type ContextDraftRef
} from "@novel-studio/agent-engine";
import { writeTextAtomically } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

const POLICY_DIRECTORY = "workspace-context-policy";
const POLICY_FILE = "policies.json";
const LEGACY_SCHEMA_VERSION = "1.0" as const;
const SCHEMA_VERSION = "1.1" as const;

export interface WorkspaceContextPolicyBinding {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly workspaceId: string;
  readonly contentRoot: string;
}

export interface WorkspaceContextPolicy {
  readonly workspaceTrust: "trusted" | "untrusted";
  readonly projectConventionsEnabled: boolean;
  readonly sourcePreferences: readonly WorkspaceContextSourcePreference[];
  /** A stable persisted revision included in the runtime capability/cache identity. */
  readonly policyRevision: string;
}

export interface WorkspaceContextSourcePreference {
  readonly refId: string;
  readonly decision: "pinned" | "excluded";
  readonly priority: number;
  /** Retained when a manually selected source must be recalled in later conversations. */
  readonly ref?: ContextDraftRef;
}

export type WorkspaceContextSourcePreferenceMutation =
  WorkspaceContextSourcePreference | { readonly refId: string; readonly decision: null };

export interface WorkspaceContextPolicyStore {
  /** Read-only lookup deliberately fails closed rather than surfacing user-data corruption. */
  read(binding: WorkspaceContextPolicyBinding): Promise<WorkspaceContextPolicy>;
  /** Called only after Main safely creates or verifies the fixed conventions file. */
  enableTrustedConventions(
    binding: WorkspaceContextPolicyBinding
  ): Promise<Result<WorkspaceContextPolicy, UnifiedError>>;
  /** Retains trust but stops injecting project conventions into new runs. */
  disableConventions(
    binding: WorkspaceContextPolicyBinding
  ): Promise<Result<WorkspaceContextPolicy, UnifiedError>>;
  /** Removes trust and disables conventions for the canonical workspace identity. */
  revokeTrust(
    binding: WorkspaceContextPolicyBinding
  ): Promise<Result<WorkspaceContextPolicy, UnifiedError>>;
  /** Adds, replaces, or removes one workspace-bound default source preference. */
  setSourcePreference(
    binding: WorkspaceContextPolicyBinding,
    mutation: WorkspaceContextSourcePreferenceMutation
  ): Promise<Result<WorkspaceContextPolicy, UnifiedError>>;
}

interface StoredPolicyFile {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly policies: Record<string, StoredWorkspaceContextPolicy>;
}

interface StoredWorkspaceContextPolicy {
  readonly workspaceKind: WorkspaceContextPolicyBinding["workspaceKind"];
  readonly workspaceId: string;
  readonly canonicalRootIdentity: string;
  readonly workspaceTrust: WorkspaceContextPolicy["workspaceTrust"];
  readonly projectConventionsEnabled: boolean;
  readonly sourcePreferences: readonly WorkspaceContextSourcePreference[];
  readonly revision: number;
}

interface ResolvedPolicyBinding {
  readonly workspaceKind: WorkspaceContextPolicyBinding["workspaceKind"];
  readonly workspaceId: string;
  readonly canonicalRootIdentity: string;
  readonly key: string;
}

const DEFAULT_POLICY_STATE = {
  workspaceTrust: "untrusted",
  projectConventionsEnabled: false,
  sourcePreferences: [] as readonly WorkspaceContextSourcePreference[]
} as const;

type WorkspaceContextPolicyState = Pick<
  WorkspaceContextPolicy,
  "workspaceTrust" | "projectConventionsEnabled" | "sourcePreferences"
>;

export function createDesktopWorkspaceContextPolicyStore(input: {
  readonly userDataRoot: string;
}): WorkspaceContextPolicyStore {
  const targetPath = join(input.userDataRoot, POLICY_DIRECTORY, POLICY_FILE);
  let writeTail: Promise<void> = Promise.resolve();

  return {
    async read(binding) {
      await writeTail.catch(() => undefined);
      const resolved = await resolveBinding(binding);
      if (resolved === undefined) return defaultPolicy("root-unavailable");
      const stored = await readPolicyFile(targetPath);
      if (stored === undefined) return defaultPolicy(resolved.key);
      const entry = stored.policies[resolved.key];
      return entry === undefined || !matchesBinding(entry, resolved)
        ? defaultPolicy(resolved.key)
        : toPolicy(entry, resolved.key);
    },
    enableTrustedConventions: (binding) =>
      mutate(binding, (previous) => ({
        ...policyState(previous),
        workspaceTrust: "trusted",
        projectConventionsEnabled: true
      })),
    disableConventions: (binding) =>
      mutate(binding, (previous) => ({
        ...policyState(previous),
        projectConventionsEnabled: false
      })),
    revokeTrust: (binding) =>
      mutate(binding, (previous) => ({
        ...policyState(previous),
        workspaceTrust: "untrusted",
        projectConventionsEnabled: false
      })),
    setSourcePreference(binding, mutation) {
      const normalized = parseWorkspaceContextSourcePreferenceMutation(mutation);
      if (normalized === undefined) {
        return Promise.resolve(
          err(policyError("WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID"))
        );
      }
      return mutate(binding, (previous) => {
        const current = policyState(previous);
        const remaining = current.sourcePreferences.filter(
          (preference) => preference.refId !== normalized.refId
        );
        return {
          ...current,
          sourcePreferences:
            normalized.decision === null
              ? remaining
              : canonicalSourcePreferences([...remaining, normalized])
        };
      });
    }
  };

  function mutate(
    binding: WorkspaceContextPolicyBinding,
    nextState:
      | WorkspaceContextPolicyState
      | ((
          previous: StoredWorkspaceContextPolicy | undefined,
          resolved: ResolvedPolicyBinding
        ) => WorkspaceContextPolicyState)
  ): Promise<Result<WorkspaceContextPolicy, UnifiedError>> {
    const operation = writeTail.then(async () => {
      const resolved = await resolveBinding(binding);
      if (resolved === undefined)
        return err(policyError("WORKSPACE_CONTEXT_POLICY_BINDING_INVALID"));
      const current = await readPolicyFile(targetPath);
      const policies = current?.policies ?? {};
      const storedPrevious = policies[resolved.key];
      const previous =
        storedPrevious !== undefined && matchesBinding(storedPrevious, resolved)
          ? storedPrevious
          : undefined;
      const resolvedState =
        typeof nextState === "function" ? nextState(previous, resolved) : nextState;
      const unchanged = previous !== undefined && sameState(previous, resolvedState);
      const entry: StoredWorkspaceContextPolicy = unchanged
        ? previous
        : {
            workspaceKind: resolved.workspaceKind,
            workspaceId: resolved.workspaceId,
            canonicalRootIdentity: resolved.canonicalRootIdentity,
            ...resolvedState,
            revision: (previous?.revision ?? 0) + 1
          };
      const written = await writePolicyFile(targetPath, {
        schemaVersion: SCHEMA_VERSION,
        policies: { ...policies, [resolved.key]: entry }
      });
      return written.ok ? ok(toPolicy(entry, resolved.key)) : written;
    });
    writeTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}

async function resolveBinding(
  binding: WorkspaceContextPolicyBinding
): Promise<ResolvedPolicyBinding | undefined> {
  if (
    (binding.workspaceKind !== "creativeProject" &&
      binding.workspaceKind !== "engineeringWorkspace") ||
    !isSafeIdentifier(binding.workspaceId) ||
    typeof binding.contentRoot !== "string" ||
    binding.contentRoot.length === 0
  ) {
    return undefined;
  }
  try {
    // Windows directory inode values may exceed Number.MAX_SAFE_INTEGER; preserve the exact
    // filesystem identity used to bind the trust decision.
    const requestedBefore = await lstat(binding.contentRoot, { bigint: true });
    if (!isVerifiedDirectory(requestedBefore)) return undefined;
    const canonicalRoot = await realpath(binding.contentRoot);
    const [canonicalEntry, canonicalTarget, requestedAfter] = await Promise.all([
      lstat(canonicalRoot, { bigint: true }),
      stat(canonicalRoot, { bigint: true }),
      lstat(binding.contentRoot, { bigint: true })
    ]);
    if (
      !isVerifiedDirectory(canonicalEntry) ||
      !isVerifiedDirectory(canonicalTarget) ||
      !isVerifiedDirectory(requestedAfter) ||
      !sameFilesystemIdentity(requestedBefore, requestedAfter) ||
      !sameFilesystemIdentity(requestedAfter, canonicalEntry) ||
      !sameFilesystemIdentity(canonicalEntry, canonicalTarget)
    ) {
      return undefined;
    }
    const canonicalRootIdentity = checksum(
      `${canonicalRoot}\n${canonicalTarget.dev.toString()}\n${canonicalTarget.ino.toString()}`
    );
    const key = checksum(
      `${binding.workspaceKind}\n${binding.workspaceId}\n${canonicalRootIdentity}`
    );
    return {
      workspaceKind: binding.workspaceKind,
      workspaceId: binding.workspaceId,
      canonicalRootIdentity,
      key
    };
  } catch {
    return undefined;
  }
}

function isVerifiedDirectory(value: {
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  readonly dev: bigint;
  readonly ino: bigint;
}): boolean {
  return value.isDirectory() && !value.isSymbolicLink() && value.dev >= 0n && value.ino > 0n;
}

function sameFilesystemIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint }
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readPolicyFile(targetPath: string): Promise<StoredPolicyFile | undefined> {
  try {
    return parsePolicyFile(JSON.parse(await readFile(targetPath, "utf8")) as unknown);
  } catch {
    return undefined;
  }
}

async function writePolicyFile(
  targetPath: string,
  contents: StoredPolicyFile
): Promise<Result<void, UnifiedError>> {
  try {
    await mkdir(dirname(targetPath), { recursive: true });
  } catch {
    return err(policyError("WORKSPACE_CONTEXT_POLICY_WRITE_FAILED"));
  }
  const written = await writeTextAtomically({
    targetPath,
    content: `${JSON.stringify(contents, null, 2)}\n`,
    traceId: "desktop-workspace-context-policy"
  });
  return written.ok ? ok(undefined) : err(policyError("WORKSPACE_CONTEXT_POLICY_WRITE_FAILED"));
}

function parsePolicyFile(value: unknown): StoredPolicyFile | undefined {
  if (
    !isRecord(value) ||
    (value["schemaVersion"] !== SCHEMA_VERSION &&
      value["schemaVersion"] !== LEGACY_SCHEMA_VERSION) ||
    !isRecord(value["policies"])
  ) {
    return undefined;
  }
  const schemaVersion = value["schemaVersion"];
  const policies: Record<string, StoredWorkspaceContextPolicy> = {};
  for (const [key, entry] of Object.entries(value["policies"])) {
    if (!isChecksum(key)) return undefined;
    const parsed = parseStoredPolicy(entry, schemaVersion);
    if (parsed === undefined) return undefined;
    policies[key] = parsed;
  }
  return { schemaVersion: SCHEMA_VERSION, policies };
}

function parseStoredPolicy(
  value: unknown,
  schemaVersion: typeof SCHEMA_VERSION | typeof LEGACY_SCHEMA_VERSION
): StoredWorkspaceContextPolicy | undefined {
  if (
    !isRecord(value) ||
    (value["workspaceKind"] !== "creativeProject" &&
      value["workspaceKind"] !== "engineeringWorkspace") ||
    !isSafeIdentifier(value["workspaceId"]) ||
    !isChecksum(value["canonicalRootIdentity"]) ||
    (value["workspaceTrust"] !== "trusted" && value["workspaceTrust"] !== "untrusted") ||
    typeof value["projectConventionsEnabled"] !== "boolean" ||
    typeof value["revision"] !== "number" ||
    !Number.isSafeInteger(value["revision"]) ||
    value["revision"] <= 0
  ) {
    return undefined;
  }
  const sourcePreferences =
    schemaVersion === LEGACY_SCHEMA_VERSION
      ? []
      : parseSourcePreferences(value["sourcePreferences"]);
  if (sourcePreferences === undefined) return undefined;
  return {
    workspaceKind: value["workspaceKind"],
    workspaceId: value["workspaceId"],
    canonicalRootIdentity: value["canonicalRootIdentity"],
    workspaceTrust: value["workspaceTrust"],
    projectConventionsEnabled: value["projectConventionsEnabled"],
    sourcePreferences,
    revision: value["revision"]
  };
}

function matchesBinding(
  entry: StoredWorkspaceContextPolicy,
  binding: ResolvedPolicyBinding
): boolean {
  return (
    entry.workspaceKind === binding.workspaceKind &&
    entry.workspaceId === binding.workspaceId &&
    entry.canonicalRootIdentity === binding.canonicalRootIdentity
  );
}

function sameState(
  entry: StoredWorkspaceContextPolicy,
  state: WorkspaceContextPolicyState
): boolean {
  return (
    entry.workspaceTrust === state.workspaceTrust &&
    entry.projectConventionsEnabled === state.projectConventionsEnabled &&
    JSON.stringify(entry.sourcePreferences) ===
      JSON.stringify(canonicalSourcePreferences(state.sourcePreferences))
  );
}

function toPolicy(entry: StoredWorkspaceContextPolicy, key: string): WorkspaceContextPolicy {
  const sourcePreferences = canonicalSourcePreferences(entry.sourcePreferences);
  return {
    workspaceTrust: entry.workspaceTrust,
    projectConventionsEnabled: entry.projectConventionsEnabled,
    sourcePreferences,
    policyRevision: checksum(
      `${key}\n${entry.workspaceTrust}\n${String(entry.projectConventionsEnabled)}\n${JSON.stringify(sourcePreferences)}\n${String(entry.revision)}`
    )
  };
}

function defaultPolicy(key: string): WorkspaceContextPolicy {
  return {
    ...DEFAULT_POLICY_STATE,
    policyRevision: checksum(`${key}\ndefault-fail-closed@1`)
  };
}

function policyState(entry: StoredWorkspaceContextPolicy | undefined): WorkspaceContextPolicyState {
  return entry === undefined
    ? DEFAULT_POLICY_STATE
    : {
        workspaceTrust: entry.workspaceTrust,
        projectConventionsEnabled: entry.projectConventionsEnabled,
        sourcePreferences: entry.sourcePreferences
      };
}

function parseSourcePreferences(
  value: unknown
): readonly WorkspaceContextSourcePreference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const preferences: WorkspaceContextSourcePreference[] = [];
  const refIds = new Set<string>();
  for (const preference of value) {
    if (!isSourcePreference(preference) || refIds.has(preference.refId)) return undefined;
    refIds.add(preference.refId);
    preferences.push(cloneSourcePreference(preference));
  }
  return canonicalSourcePreferences(preferences);
}

function canonicalSourcePreferences(
  preferences: readonly WorkspaceContextSourcePreference[]
): readonly WorkspaceContextSourcePreference[] {
  return preferences
    .map(cloneSourcePreference)
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.refId.localeCompare(right.refId) ||
        left.decision.localeCompare(right.decision)
    );
}

export function parseWorkspaceContextSourcePreferenceMutation(
  value: unknown
): WorkspaceContextSourcePreferenceMutation | undefined {
  if (!isRecord(value) || !isValidRefId(value["refId"])) return undefined;
  if (value["decision"] === null) {
    return hasOnlyKeys(value, ["refId", "decision"])
      ? { refId: value["refId"], decision: null }
      : undefined;
  }
  return isSourcePreference(value) ? cloneSourcePreference(value) : undefined;
}

function isSourcePreference(value: unknown): value is WorkspaceContextSourcePreference {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["refId", "decision", "priority", "ref"]) ||
    !isValidRefId(value["refId"]) ||
    (value["decision"] !== "pinned" && value["decision"] !== "excluded") ||
    !isPriority(value["priority"]) ||
    (value["ref"] !== undefined &&
      (!isContextDraftRef(value["ref"]) || value["ref"].refId !== value["refId"]))
  ) {
    return false;
  }
  return true;
}

function cloneSourcePreference(
  preference: WorkspaceContextSourcePreference
): WorkspaceContextSourcePreference {
  return preference.ref === undefined
    ? {
        refId: preference.refId,
        decision: preference.decision,
        priority: preference.priority
      }
    : {
        refId: preference.refId,
        decision: preference.decision,
        priority: preference.priority,
        ref: cloneContextDraftRef(preference.ref)
      };
}

function isContextDraftRef(value: unknown): value is ContextDraftRef {
  if (!isRecord(value) || !isValidRefId(value["refId"]) || !isDisplayLabel(value["label"])) {
    return false;
  }
  switch (value["kind"]) {
    case "chapter":
      return (
        hasOnlyKeys(value, ["kind", "refId", "chapterId", "label", "range"]) &&
        isSafeIdentifier(value["chapterId"]) &&
        (value["range"] === undefined || isContextRange(value["range"]))
      );
    case "story_bible":
      return (
        hasOnlyKeys(value, ["kind", "refId", "assetId", "label"]) &&
        isSafeIdentifier(value["assetId"])
      );
    case "project_file": {
      if (
        !hasOnlyKeys(value, [
          "kind",
          "refId",
          "relativePath",
          "label",
          "range",
          "expectedChecksum"
        ]) ||
        typeof value["relativePath"] !== "string" ||
        (value["range"] !== undefined && !isContextRange(value["range"])) ||
        (value["expectedChecksum"] !== undefined && !isChecksum(value["expectedChecksum"]))
      ) {
        return false;
      }
      const validated = validateAgentRelativePath(value["relativePath"]);
      return validated.ok && validated.value.relativePath === value["relativePath"];
    }
    case "editor_selection":
      return (
        hasOnlyKeys(value, ["kind", "refId", "editorRevision", "label", "range"]) &&
        typeof value["editorRevision"] === "number" &&
        Number.isSafeInteger(value["editorRevision"]) &&
        value["editorRevision"] >= 0 &&
        isContextRange(value["range"])
      );
    default:
      return false;
  }
}

function cloneContextDraftRef(ref: ContextDraftRef): ContextDraftRef {
  switch (ref.kind) {
    case "chapter":
      return ref.range === undefined
        ? { kind: ref.kind, refId: ref.refId, chapterId: ref.chapterId, label: ref.label }
        : {
            kind: ref.kind,
            refId: ref.refId,
            chapterId: ref.chapterId,
            label: ref.label,
            range: cloneContextRange(ref.range)
          };
    case "story_bible":
      return { kind: ref.kind, refId: ref.refId, assetId: ref.assetId, label: ref.label };
    case "project_file":
      return {
        kind: ref.kind,
        refId: ref.refId,
        relativePath: ref.relativePath,
        label: ref.label,
        ...(ref.range === undefined ? {} : { range: cloneContextRange(ref.range) }),
        ...(ref.expectedChecksum === undefined ? {} : { expectedChecksum: ref.expectedChecksum })
      };
    case "editor_selection":
      return {
        kind: ref.kind,
        refId: ref.refId,
        editorRevision: ref.editorRevision,
        label: ref.label,
        range: cloneContextRange(ref.range)
      };
  }
}

function isContextRange(value: unknown): value is AgentContextRange {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["start", "end"]) &&
    typeof value["start"] === "number" &&
    Number.isSafeInteger(value["start"]) &&
    value["start"] >= 0 &&
    typeof value["end"] === "number" &&
    Number.isSafeInteger(value["end"]) &&
    value["end"] >= value["start"]
  );
}

function cloneContextRange(range: AgentContextRange): AgentContextRange {
  return { start: range.start, end: range.end };
}

function isValidRefId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !containsControlCharacter(value)
  );
}

function isDisplayLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !containsControlCharacter(value)
  );
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isPriority(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && /^[A-Za-z0-9._-]+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function policyError(
  code:
    | "WORKSPACE_CONTEXT_POLICY_BINDING_INVALID"
    | "WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID"
    | "WORKSPACE_CONTEXT_POLICY_WRITE_FAILED"
): UnifiedError {
  return createUnifiedError({
    code,
    category: code === "WORKSPACE_CONTEXT_POLICY_WRITE_FAILED" ? "StorageError" : "ValidationError",
    message:
      code === "WORKSPACE_CONTEXT_POLICY_BINDING_INVALID"
        ? "The active workspace identity is unavailable for this policy change."
        : code === "WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID"
          ? "The project context source preference is invalid."
          : "The workspace conventions policy could not be persisted.",
    recoverability: "user-action",
    suggestedAction:
      code === "WORKSPACE_CONTEXT_POLICY_SOURCE_PREFERENCE_INVALID"
        ? "Choose a valid context source, decision, and priority, then retry."
        : "Reopen the workspace and retry.",
    traceId: "desktop-workspace-context-policy"
  });
}
