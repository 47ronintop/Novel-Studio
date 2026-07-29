/**
 * Main-only persistence for whether project-authored conventions may influence an Agent run.
 * A policy is bound to the canonical workspace root and its filesystem identity, so moving or
 * replacing a workspace cannot inherit a prior trust decision. Missing or malformed state
 * intentionally fails closed.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { writeTextAtomically } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

const POLICY_DIRECTORY = "workspace-context-policy";
const POLICY_FILE = "policies.json";
const SCHEMA_VERSION = "1.0" as const;

export interface WorkspaceContextPolicyBinding {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly workspaceId: string;
  readonly contentRoot: string;
}

export interface WorkspaceContextPolicy {
  readonly workspaceTrust: "trusted" | "untrusted";
  readonly projectConventionsEnabled: boolean;
  /** A stable persisted revision included in the runtime capability/cache identity. */
  readonly policyRevision: string;
}

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
  projectConventionsEnabled: false
} as const;

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
      mutate(binding, {
        workspaceTrust: "trusted",
        projectConventionsEnabled: true
      }),
    disableConventions: (binding) =>
      mutate(binding, (previous, resolved) => ({
        workspaceTrust:
          previous !== undefined && matchesBinding(previous, resolved)
            ? previous.workspaceTrust
            : "untrusted",
        projectConventionsEnabled: false
      })),
    revokeTrust: (binding) =>
      mutate(binding, {
        workspaceTrust: "untrusted",
        projectConventionsEnabled: false
      })
  };

  function mutate(
    binding: WorkspaceContextPolicyBinding,
    nextState:
      | Pick<WorkspaceContextPolicy, "workspaceTrust" | "projectConventionsEnabled">
      | ((
          previous: StoredWorkspaceContextPolicy | undefined,
          resolved: ResolvedPolicyBinding
        ) => Pick<WorkspaceContextPolicy, "workspaceTrust" | "projectConventionsEnabled">)
  ): Promise<Result<WorkspaceContextPolicy, UnifiedError>> {
    const operation = writeTail.then(async () => {
      const resolved = await resolveBinding(binding);
      if (resolved === undefined)
        return err(policyError("WORKSPACE_CONTEXT_POLICY_BINDING_INVALID"));
      const current = await readPolicyFile(targetPath);
      const policies = current?.policies ?? {};
      const previous = policies[resolved.key];
      const resolvedState =
        typeof nextState === "function" ? nextState(previous, resolved) : nextState;
      const unchanged =
        previous !== undefined &&
        matchesBinding(previous, resolved) &&
        sameState(previous, resolvedState);
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
    value["schemaVersion"] !== SCHEMA_VERSION ||
    !isRecord(value["policies"])
  ) {
    return undefined;
  }
  const policies: Record<string, StoredWorkspaceContextPolicy> = {};
  for (const [key, entry] of Object.entries(value["policies"])) {
    if (!isChecksum(key) || !isStoredPolicy(entry)) return undefined;
    policies[key] = entry;
  }
  return { schemaVersion: SCHEMA_VERSION, policies };
}

function isStoredPolicy(value: unknown): value is StoredWorkspaceContextPolicy {
  return (
    isRecord(value) &&
    (value["workspaceKind"] === "creativeProject" ||
      value["workspaceKind"] === "engineeringWorkspace") &&
    isSafeIdentifier(value["workspaceId"]) &&
    isChecksum(value["canonicalRootIdentity"]) &&
    (value["workspaceTrust"] === "trusted" || value["workspaceTrust"] === "untrusted") &&
    typeof value["projectConventionsEnabled"] === "boolean" &&
    typeof value["revision"] === "number" &&
    Number.isSafeInteger(value["revision"]) &&
    value["revision"] > 0
  );
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
  state: Pick<WorkspaceContextPolicy, "workspaceTrust" | "projectConventionsEnabled">
): boolean {
  return (
    entry.workspaceTrust === state.workspaceTrust &&
    entry.projectConventionsEnabled === state.projectConventionsEnabled
  );
}

function toPolicy(entry: StoredWorkspaceContextPolicy, key: string): WorkspaceContextPolicy {
  return {
    workspaceTrust: entry.workspaceTrust,
    projectConventionsEnabled: entry.projectConventionsEnabled,
    policyRevision: checksum(
      `${key}\n${entry.workspaceTrust}\n${String(entry.projectConventionsEnabled)}\n${String(entry.revision)}`
    )
  };
}

function defaultPolicy(key: string): WorkspaceContextPolicy {
  return {
    ...DEFAULT_POLICY_STATE,
    policyRevision: checksum(`${key}\ndefault-fail-closed@1`)
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]+$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function policyError(
  code: "WORKSPACE_CONTEXT_POLICY_BINDING_INVALID" | "WORKSPACE_CONTEXT_POLICY_WRITE_FAILED"
): UnifiedError {
  return createUnifiedError({
    code,
    category:
      code === "WORKSPACE_CONTEXT_POLICY_BINDING_INVALID" ? "ValidationError" : "StorageError",
    message:
      code === "WORKSPACE_CONTEXT_POLICY_BINDING_INVALID"
        ? "The active workspace identity is unavailable for this policy change."
        : "The workspace conventions policy could not be persisted.",
    recoverability: "user-action",
    suggestedAction: "Reopen the workspace and retry.",
    traceId: "desktop-workspace-context-policy"
  });
}
