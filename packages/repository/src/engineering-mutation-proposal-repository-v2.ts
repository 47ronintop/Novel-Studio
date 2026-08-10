import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  parseChangeSetV2,
  validateEngineeringRelativePath,
  type ChangeSetV2
} from "@novel-studio/agent-engine";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  doesEngineeringMutationBlobMatchManifestV2,
  sha256EngineeringMutationTextV2,
  validateEngineeringMutationBeforeImageV2,
  validateEngineeringMutationCandidateImageV2,
  type EngineeringFileMutationOperationKindV2,
  type EngineeringFileLifecycleOperationKindV2,
  type EngineeringMutationBeforeImageV2,
  type EngineeringMutationCandidateImageV2
} from "./engineering-file-mutation-port-v2.js";
import {
  type EngineeringStateDirectoryEntryV2,
  type EngineeringStateDurabilityPortV2,
  type EngineeringStateFileHandleV2
} from "./engineering-mutation-blob-store.js";
import { storageError, validationError } from "./errors.js";

/**
 * Engineering proposals are a separate, Main-owned durable protocol. They intentionally do not
 * share the creative/writing journal namespace or schema.
 */
export const ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION =
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION;

export type EngineeringMutationProposalStatusV2 = "proposed" | "rejected" | "applied";

/** Immutable raw proposal facts prepared before Change Set/approval binding. */
interface EngineeringMutationProposalPayloadBaseV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly toolCallId: string;
  /** Digest of the exact canonical Provider tool payload, not a display checksum. */
  readonly canonicalPayloadChecksum: string;
  readonly contentRootBindingId: string;
  readonly pathPolicyRevision: string;
  readonly policyRevision: string;
  readonly capabilityRevision: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  /** Allocated before any approval or mutation attempt. */
  readonly operationId: string;
  /** Allocated before any approval or mutation attempt. */
  readonly stagingObjectId: string;
}

export interface EngineeringMutationLifecycleTargetProofV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION;
  readonly kind: "absent" | "same_object_case_only";
  readonly relativeIdentity: string;
  readonly parentDirectoryIdentity: string;
  readonly proofChecksum: string;
}

export type EngineeringMutationProposalPayloadV2 =
  | (EngineeringMutationProposalPayloadBaseV2 & {
      readonly operationKind: EngineeringFileMutationOperationKindV2;
      readonly relativeIdentity: string;
      /** Main-issued opaque source reference. It is never a pathname. */
      readonly sourceRef: string;
      /** Main-issued opaque target reference. It is never a pathname. */
      readonly targetRef: string;
      readonly before: EngineeringMutationBeforeImageV2;
      readonly candidate: EngineeringMutationCandidateImageV2;
    })
  | (EngineeringMutationProposalPayloadBaseV2 & {
      readonly operationKind: EngineeringFileLifecycleOperationKindV2;
      /** Primary Change Set identity: source for move/delete, target for directory create. */
      readonly relativeIdentity: string;
      readonly sourceRef: string;
      readonly targetRef: string;
      readonly before: EngineeringMutationBeforeImageV2;
      readonly targetRelativeIdentity: string;
      readonly targetProof: EngineeringMutationLifecycleTargetProofV2 | null;
      readonly recoveryRootBindingId: string | null;
      readonly recoveryGrantRevision: string | null;
      readonly recoverySideEffectChecksum: string | null;
      readonly recoveryObjectId: string | null;
    });

type EngineeringRawMutationProposalPayloadV2 = Extract<
  EngineeringMutationProposalPayloadV2,
  { readonly operationKind: EngineeringFileMutationOperationKindV2 }
>;
type EngineeringLifecycleMutationProposalPayloadV2 = Extract<
  EngineeringMutationProposalPayloadV2,
  { readonly operationKind: EngineeringFileLifecycleOperationKindV2 }
>;

export type EngineeringMutationProposalCreateInputV2 = EngineeringMutationProposalPayloadV2;

/**
 * The exact Change Set 2.0 revision selected for this proposal. The full Change Set is verified
 * at bind time; only the immutable facts needed by later Main-only revalidation are persisted.
 */
export interface EngineeringMutationProposalChangeSetBindingV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly displayBindingChecksum: string;
  readonly selectionChecksum: string;
  readonly operationOrderChecksum: string;
  readonly selectedOperationIds: readonly string[];
}

/** A complete durable proposal envelope. `recordChecksum` covers mutable state as well. */
interface EngineeringMutationProposalRecordFieldsV2 {
  readonly kind: "engineering_mutation_proposal";
  /** SHA-256 over the complete immutable raw proposal payload. */
  readonly proposalPayloadChecksum: string;
  readonly changeSetBinding: EngineeringMutationProposalChangeSetBindingV2 | null;
  readonly status: EngineeringMutationProposalStatusV2;
  readonly createdAt: string;
  readonly rejectedAt: string | null;
  readonly appliedAt: string | null;
  /** Tamper-evident checksum over every persisted field except this one. */
  readonly recordChecksum: string;
}

export type EngineeringMutationProposalRecordV2 = EngineeringMutationProposalPayloadV2 &
  EngineeringMutationProposalRecordFieldsV2;

export interface EngineeringMutationProposalRunToolCallLookupV2 {
  readonly runId: string;
  readonly toolCallId: string;
}

export interface EngineeringMutationProposalBindChangeSetInputV2 {
  readonly proposalId: string;
  /** Must be a strict, current Change Set 2.0 record from Main storage. */
  readonly changeSet: ChangeSetV2;
  readonly selectionChecksum: string;
  readonly operationOrderChecksum: string;
  readonly selectedOperationIds: readonly string[];
}

export interface EngineeringMutationProposalScanV2 {
  readonly schemaVersion: typeof ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION;
  readonly proposals: readonly EngineeringMutationProposalRecordV2[];
  readonly unknownObjectCount: number;
  readonly authenticationFailureCount: number;
}

export interface EngineeringMutationProposalRepositoryV2 {
  create(input: unknown): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>>;
  getByProposalId(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>>;
  getByRunToolCall(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>>;
  bindChangeSet(input: unknown): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>>;
  reject(proposalId: string): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>>;
  markApplied(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>>;
  scan(): Promise<Result<EngineeringMutationProposalScanV2, UnifiedError>>;
}

export interface InMemoryEngineeringMutationProposalRepositoryV2Options {
  readonly now?: () => string;
}

/** Strict in-memory implementation for application composition and focused tests. */
export class InMemoryEngineeringMutationProposalRepositoryV2 implements EngineeringMutationProposalRepositoryV2 {
  private readonly byProposalId = new Map<string, EngineeringMutationProposalRecordV2>();
  private readonly byRunToolCall = new Map<string, string>();
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly now: () => string;

  public constructor(options: InMemoryEngineeringMutationProposalRepositoryV2Options = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async create(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      const payload = parsePayload(input);
      if (payload === undefined) return invalid("ENGINEERING_MUTATION_PROPOSAL_INPUT_INVALID");

      const existingId = this.byRunToolCall.get(runToolCallKey(payload.runId, payload.toolCallId));
      if (existingId !== undefined) {
        const existing = this.byProposalId.get(existingId);
        if (existing === undefined) return authenticationFailure();
        return existing.canonicalPayloadChecksum === payload.canonicalPayloadChecksum
          ? ok(existing)
          : toolCallConflict();
      }
      if (this.byProposalId.has(payload.proposalId)) return proposalIdConflict();

      const record = createRecord(payload, this.now());
      if (record === undefined) return clockInvalid();
      this.byProposalId.set(record.proposalId, record);
      this.byRunToolCall.set(runToolCallKey(record.runId, record.toolCallId), record.proposalId);
      return ok(record);
    });
  }

  public async getByProposalId(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>> {
    return this.serialized(async () => {
      if (!isStableId(proposalId)) return invalid("ENGINEERING_MUTATION_PROPOSAL_ID_INVALID");
      const records = this.consistentRecords();
      if (!records.ok) return records;
      return ok(records.value.find((record) => record.proposalId === proposalId));
    });
  }

  public async getByRunToolCall(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>> {
    return this.serialized(async () => {
      const lookup = parseRunToolCallLookup(input);
      if (lookup === undefined) return invalid("ENGINEERING_MUTATION_PROPOSAL_LOOKUP_INVALID");
      const records = this.consistentRecords();
      if (!records.ok) return records;
      return ok(
        records.value.find(
          (record) => record.runId === lookup.runId && record.toolCallId === lookup.toolCallId
        )
      );
    });
  }

  public async bindChangeSet(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      const bind = parseBindInput(input);
      if (bind === undefined) return invalid("ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_INVALID");
      const current = this.byProposalId.get(bind.proposalId);
      if (current === undefined) return missing();
      const valid = validateEngineeringMutationProposalRecordV2(current);
      if (!valid.ok) return authenticationFailure();
      const binding = createChangeSetBinding(valid.value, bind);
      if (binding === undefined) return invalid("ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_INVALID");
      if (valid.value.changeSetBinding !== null) {
        return sameCanonicalJson(valid.value.changeSetBinding, binding)
          ? ok(valid.value)
          : changeSetConflict();
      }
      if (valid.value.status !== "proposed") return stateConflict();

      const next = sealRecord({ ...valid.value, changeSetBinding: binding });
      this.byProposalId.set(next.proposalId, next);
      return ok(next);
    });
  }

  public async reject(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.transition(proposalId, "rejected");
  }

  public async markApplied(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.transition(proposalId, "applied");
  }

  public async scan(): Promise<Result<EngineeringMutationProposalScanV2, UnifiedError>> {
    return this.serialized(async () => {
      const records = this.consistentRecords();
      if (!records.ok) return records;
      return ok(emptyScan(records.value));
    });
  }

  private async transition(
    proposalId: string,
    target: "rejected" | "applied"
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      if (!isStableId(proposalId)) return invalid("ENGINEERING_MUTATION_PROPOSAL_ID_INVALID");
      const current = this.byProposalId.get(proposalId);
      if (current === undefined) return missing();
      const valid = validateEngineeringMutationProposalRecordV2(current);
      if (!valid.ok) return authenticationFailure();
      if (valid.value.status === target) return ok(valid.value);
      if (valid.value.status !== "proposed") return stateConflict();
      if (target === "applied" && valid.value.changeSetBinding === null) return changeSetUnbound();

      const at = this.now();
      if (!isCanonicalTimestamp(at)) return clockInvalid();
      const next = sealRecord({
        ...valid.value,
        status: target,
        rejectedAt: target === "rejected" ? at : null,
        appliedAt: target === "applied" ? at : null
      });
      this.byProposalId.set(next.proposalId, next);
      return ok(next);
    });
  }

  private consistentRecords(): Result<
    readonly EngineeringMutationProposalRecordV2[],
    UnifiedError
  > {
    const records: EngineeringMutationProposalRecordV2[] = [];
    const runToolCalls = new Set<string>();
    for (const [proposalId, record] of this.byProposalId) {
      const valid = validateEngineeringMutationProposalRecordV2(record);
      if (!valid.ok || proposalId !== record.proposalId) return authenticationFailure();
      const key = runToolCallKey(record.runId, record.toolCallId);
      if (runToolCalls.has(key) || this.byRunToolCall.get(key) !== proposalId) {
        return authenticationFailure();
      }
      runToolCalls.add(key);
      records.push(valid.value);
    }
    if (this.byRunToolCall.size !== records.length) return authenticationFailure();
    return ok(freeze(records.sort(compareProposal)));
  }

  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const previous = this.operationQueue;
    let release: (() => void) | undefined;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

export interface FileEngineeringMutationProposalRepositoryV2Options {
  /** Main-owned app state root, never a Provider-selected content root. */
  readonly stateRoot: string;
  /** Qualified no-follow/directory-flush state durability supplied by Desktop Main. */
  readonly durability: EngineeringStateDurabilityPortV2;
  readonly now?: () => string;
  readonly traceId?: string;
}

/**
 * Durable file repository. It deliberately uses only EngineeringStateDurabilityPortV2: there is
 * no Node fs fallback, and every on-disk id is a hash rather than a run/tool/proposal identifier.
 */
export class FileEngineeringMutationProposalRepositoryV2 implements EngineeringMutationProposalRepositoryV2 {
  private static readonly queues = new Map<string, Promise<void>>();
  private readonly traceId: string;
  private readonly now: () => string;

  public constructor(private readonly options: FileEngineeringMutationProposalRepositoryV2Options) {
    this.traceId = options.traceId ?? "engineering-mutation-proposal-repository-v2";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async create(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      const payload = parsePayload(input);
      if (payload === undefined) {
        return invalid("ENGINEERING_MUTATION_PROPOSAL_INPUT_INVALID", this.traceId);
      }
      const durability = this.qualifiedDurability();
      if (durability === undefined) return durabilityUnavailable(this.traceId);
      const records = await this.currentRecords(durability);
      if (!records.ok) return records;

      const existingToolCall = records.value.find(
        (record) => record.runId === payload.runId && record.toolCallId === payload.toolCallId
      );
      if (existingToolCall !== undefined) {
        return existingToolCall.canonicalPayloadChecksum === payload.canonicalPayloadChecksum
          ? ok(existingToolCall)
          : toolCallConflict(this.traceId);
      }
      if (records.value.some((record) => record.proposalId === payload.proposalId)) {
        return proposalIdConflict(this.traceId);
      }

      const record = createRecord(payload, this.now());
      if (record === undefined) return clockInvalid(this.traceId);
      const persisted = await this.persist(record, "create", durability);
      if (!persisted.ok) {
        // A separate Main process can win between the scan and the create-only link. Re-read its
        // record so an identical canonical tool payload remains idempotent instead of becoming a
        // spurious conflict.
        if (persisted.error.code === "ENGINEERING_MUTATION_PROPOSAL_TOOL_CALL_CONFLICT") {
          const afterRace = await this.currentRecords(durability);
          if (!afterRace.ok) return afterRace;
          const existing = afterRace.value.find(
            (candidate) =>
              candidate.runId === payload.runId && candidate.toolCallId === payload.toolCallId
          );
          if (
            existing !== undefined &&
            existing.canonicalPayloadChecksum === payload.canonicalPayloadChecksum
          ) {
            return ok(existing);
          }
        }
        return persisted;
      }
      return this.readPersisted(record.proposalId, durability);
    });
  }

  public async getByProposalId(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>> {
    return this.serialized(async () => {
      if (!isStableId(proposalId)) {
        return invalid("ENGINEERING_MUTATION_PROPOSAL_ID_INVALID", this.traceId);
      }
      const durability = this.qualifiedDurability();
      if (durability === undefined) return durabilityUnavailable(this.traceId);
      const records = await this.currentRecords(durability);
      if (!records.ok) return records;
      return ok(records.value.find((record) => record.proposalId === proposalId));
    });
  }

  public async getByRunToolCall(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>> {
    return this.serialized(async () => {
      const lookup = parseRunToolCallLookup(input);
      if (lookup === undefined) {
        return invalid("ENGINEERING_MUTATION_PROPOSAL_LOOKUP_INVALID", this.traceId);
      }
      const durability = this.qualifiedDurability();
      if (durability === undefined) return durabilityUnavailable(this.traceId);
      const records = await this.currentRecords(durability);
      if (!records.ok) return records;
      return ok(
        records.value.find(
          (record) => record.runId === lookup.runId && record.toolCallId === lookup.toolCallId
        )
      );
    });
  }

  public async bindChangeSet(
    input: unknown
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      const bind = parseBindInput(input);
      if (bind === undefined) {
        return invalid("ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_INVALID", this.traceId);
      }
      const durability = this.qualifiedDurability();
      if (durability === undefined) return durabilityUnavailable(this.traceId);
      const current = await this.readRequired(bind.proposalId, durability);
      if (!current.ok) return current;
      const binding = createChangeSetBinding(current.value, bind);
      if (binding === undefined) {
        return invalid("ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_INVALID", this.traceId);
      }
      if (current.value.changeSetBinding !== null) {
        return sameCanonicalJson(current.value.changeSetBinding, binding)
          ? ok(current.value)
          : changeSetConflict(this.traceId);
      }
      if (current.value.status !== "proposed") return stateConflict(this.traceId);

      const next = sealRecord({ ...current.value, changeSetBinding: binding });
      const persisted = await this.persist(next, "replace", durability);
      return persisted.ok ? this.readPersisted(next.proposalId, durability) : persisted;
    });
  }

  public async reject(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.transition(proposalId, "rejected");
  }

  public async markApplied(
    proposalId: string
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.transition(proposalId, "applied");
  }

  public async scan(): Promise<Result<EngineeringMutationProposalScanV2, UnifiedError>> {
    return this.serialized(async () => {
      const durability = this.qualifiedDurability();
      if (durability === undefined) return durabilityUnavailable(this.traceId);
      return this.scanUnlocked(durability);
    });
  }

  private async transition(
    proposalId: string,
    target: "rejected" | "applied"
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    return this.serialized(async () => {
      if (!isStableId(proposalId)) {
        return invalid("ENGINEERING_MUTATION_PROPOSAL_ID_INVALID", this.traceId);
      }
      const durability = this.qualifiedDurability();
      if (durability === undefined) return durabilityUnavailable(this.traceId);
      const current = await this.readRequired(proposalId, durability);
      if (!current.ok) return current;
      if (current.value.status === target) return ok(current.value);
      if (current.value.status !== "proposed") return stateConflict(this.traceId);
      if (target === "applied" && current.value.changeSetBinding === null) {
        return changeSetUnbound(this.traceId);
      }
      const at = this.now();
      if (!isCanonicalTimestamp(at)) return clockInvalid(this.traceId);
      const next = sealRecord({
        ...current.value,
        status: target,
        rejectedAt: target === "rejected" ? at : null,
        appliedAt: target === "applied" ? at : null
      });
      const persisted = await this.persist(next, "replace", durability);
      return persisted.ok ? this.readPersisted(next.proposalId, durability) : persisted;
    });
  }

  private async readRequired(
    proposalId: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    const records = await this.currentRecords(durability);
    if (!records.ok) return records;
    const current = records.value.find((record) => record.proposalId === proposalId);
    return current === undefined ? missing(this.traceId) : ok(current);
  }

  private async readPersisted(
    proposalId: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationProposalRecordV2, UnifiedError>> {
    const records = await this.currentRecords(durability);
    if (!records.ok) return records;
    const current = records.value.find((record) => record.proposalId === proposalId);
    return current === undefined ? authenticationFailure(this.traceId) : ok(current);
  }

  private async currentRecords(
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<readonly EngineeringMutationProposalRecordV2[], UnifiedError>> {
    const scanned = await this.scanUnlocked(durability);
    if (!scanned.ok) return err(scanned.error);
    if (scanned.value.unknownObjectCount > 0) return unknownObject(this.traceId);
    if (scanned.value.authenticationFailureCount > 0) return authenticationFailure(this.traceId);
    return ok(scanned.value.proposals);
  }

  private async scanUnlocked(
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationProposalScanV2, UnifiedError>> {
    let entries: readonly EngineeringStateDirectoryEntryV2[];
    try {
      entries = await durability.readDirectoryNoFollow(this.directory());
    } catch (cause) {
      if (isMissing(cause)) return ok(emptyScan([]));
      return storageFailure("ENGINEERING_MUTATION_PROPOSAL_SCAN_FAILED", this.traceId);
    }

    const proposals: EngineeringMutationProposalRecordV2[] = [];
    const proposalIds = new Set<string>();
    const runToolCalls = new Set<string>();
    let unknownObjectCount = 0;
    let authenticationFailureCount = 0;
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.kind !== "file" || !isDiskRecordName(entry.name)) {
        unknownObjectCount += 1;
        continue;
      }
      const record = await this.readRecordAtPath(join(this.directory(), entry.name), durability);
      if (!record.ok) {
        if (record.error.code === "ENGINEERING_MUTATION_PROPOSAL_AUTHENTICATION_FAILED") {
          authenticationFailureCount += 1;
          continue;
        }
        return record;
      }
      if (record.value === undefined) {
        unknownObjectCount += 1;
        continue;
      }
      const runToolCall = runToolCallKey(record.value.runId, record.value.toolCallId);
      if (
        entry.name !== this.recordFileName(record.value.runId, record.value.toolCallId) ||
        proposalIds.has(record.value.proposalId) ||
        runToolCalls.has(runToolCall)
      ) {
        authenticationFailureCount += 1;
        continue;
      }
      proposalIds.add(record.value.proposalId);
      runToolCalls.add(runToolCall);
      proposals.push(record.value);
    }
    return ok(
      freeze({
        schemaVersion: ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION,
        proposals: freeze(proposals.sort(compareProposal)),
        unknownObjectCount,
        authenticationFailureCount
      })
    );
  }

  private async readRecordAtPath(
    path: string,
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<EngineeringMutationProposalRecordV2 | undefined, UnifiedError>> {
    try {
      const raw = await durability.readFileNoFollow(path);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      const record = validateEngineeringMutationProposalRecordV2(JSON.parse(text));
      return record.ok ? ok(record.value) : authenticationFailure(this.traceId);
    } catch (cause) {
      if (isMissing(cause)) return ok(undefined);
      if (cause instanceof SyntaxError) return authenticationFailure(this.traceId);
      return storageFailure("ENGINEERING_MUTATION_PROPOSAL_READ_FAILED", this.traceId);
    }
  }

  private async persist(
    record: EngineeringMutationProposalRecordV2,
    mode: "create" | "replace",
    durability: EngineeringStateDurabilityPortV2
  ): Promise<Result<void, UnifiedError>> {
    const directory = this.directory();
    const target = this.recordPath(record.runId, record.toolCallId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    let handle: EngineeringStateFileHandleV2 | undefined;
    let temporaryCreated = false;
    let result: Result<void, UnifiedError> | undefined;
    try {
      await durability.ensureDirectoryNoFollow(directory);
      await durability.flushDirectory(directory);
      handle = await durability.openExclusiveNoFollow(temporary);
      temporaryCreated = true;
      await handle.writeFile(
        new TextEncoder().encode(canonicalizeEngineeringMutationV2Json(record))
      );
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (mode === "create") {
        try {
          // Hard-link install is the qualified create-only primitive. It cannot replace another
          // proposal record if a second process wins the same run/toolCall namespace race.
          await durability.linkNoFollow(temporary, target);
        } catch (cause) {
          if (isAlreadyExists(cause)) result = toolCallConflict(this.traceId);
          else throw cause;
        }
      } else {
        // Mutable fields (Change Set binding and terminal state) use a synced temp + atomic rename.
        await durability.renameReplaceNoFollow(temporary, target);
      }
      if (result === undefined) {
        await durability.flushDirectory(directory);
        result = ok(undefined);
      }
    } catch {
      result = storageFailure("ENGINEERING_MUTATION_PROPOSAL_WRITE_FAILED", this.traceId);
    }

    try {
      if (handle !== undefined) await handle.close();
      if (temporaryCreated) {
        await durability.unlinkNoFollow(temporary);
        await durability.flushDirectory(directory);
      }
    } catch (cause) {
      // If a process actually crashes here the strict scanner sees the leftover temp and blocks
      // all later reads/writes. A live cleanup failure follows the same fail-closed outcome.
      if (!isMissing(cause)) {
        return storageFailure("ENGINEERING_MUTATION_PROPOSAL_WRITE_FAILED", this.traceId);
      }
    }
    return result ?? storageFailure("ENGINEERING_MUTATION_PROPOSAL_WRITE_FAILED", this.traceId);
  }

  private directory(): string {
    return join(this.options.stateRoot, "engineering-v2", "proposals");
  }

  private recordPath(runId: string, toolCallId: string): string {
    return join(this.directory(), this.recordFileName(runId, toolCallId));
  }

  private recordFileName(runId: string, toolCallId: string): string {
    return `${diskKey("tool-call", runToolCallKey(runId, toolCallId))}.json`;
  }

  private qualifiedDurability(): EngineeringStateDurabilityPortV2 | undefined {
    return this.options.durability?.qualification === "qualified"
      ? this.options.durability
      : undefined;
  }

  private async serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const queueKey = this.options.stateRoot;
    const previous =
      FileEngineeringMutationProposalRepositoryV2.queues.get(queueKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    FileEngineeringMutationProposalRepositoryV2.queues.set(queueKey, current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (FileEngineeringMutationProposalRepositoryV2.queues.get(queueKey) === current) {
        FileEngineeringMutationProposalRepositoryV2.queues.delete(queueKey);
      }
    }
  }
}

/** Validates every immutable and mutable field read from durable state. */
export function validateEngineeringMutationProposalRecordV2(
  value: unknown
): Result<EngineeringMutationProposalRecordV2, UnifiedError> {
  const parsed = parseRecord(value);
  return parsed === undefined
    ? invalid("ENGINEERING_MUTATION_PROPOSAL_RECORD_INVALID")
    : ok(parsed);
}

/** SHA-256 over the full immutable proposal payload, including raw-manifest/blob bindings. */
export function engineeringMutationProposalPayloadChecksumV2(value: unknown): string {
  const payload = parsePayload(value);
  if (payload === undefined) throw new Error("ENGINEERING_MUTATION_PROPOSAL_INPUT_INVALID");
  return sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(payload));
}

/** SHA-256 over the complete durable record excluding the checksum field itself. */
export function engineeringMutationProposalRecordChecksumV2(value: unknown): string {
  return sha256EngineeringMutationTextV2(canonicalizeEngineeringMutationV2Json(value));
}

function parsePayload(value: unknown): EngineeringMutationProposalPayloadV2 | undefined {
  if (!isRecord(value)) return undefined;
  const operationKind = value["operationKind"];
  const lifecycle = isLifecycleOperationKind(operationKind);
  if (!hasExactKeys(value, lifecycle ? lifecyclePayloadKeys : rawPayloadKeys)) return undefined;
  const relativePath = validateEngineeringRelativePath(value["relativeIdentity"]);
  const before = validateEngineeringMutationBeforeImageV2(value["before"]);
  if (!relativePath.ok || !before.ok) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION ||
    !isStableId(value["proposalId"]) ||
    !isStableId(value["runId"]) ||
    !isStableId(value["projectId"]) ||
    !isStableId(value["toolCallId"]) ||
    !isSha256(value["canonicalPayloadChecksum"]) ||
    (!isOperationKind(operationKind) && !lifecycle) ||
    !isStableId(value["contentRootBindingId"]) ||
    !isOpaqueIdentity(value["pathPolicyRevision"]) ||
    !isOpaqueIdentity(value["policyRevision"]) ||
    !isOpaqueIdentity(value["capabilityRevision"]) ||
    !isSha256(value["providerSemanticVersionSetChecksum"]) ||
    !isRuleSetVersion(value["approvalRuleSetVersion"]) ||
    !isSha256(value["approvalRuleSetChecksum"]) ||
    !isOpaqueRef(value["sourceRef"]) ||
    !isOpaqueRef(value["targetRef"]) ||
    !isStableOperationId(value["operationId"]) ||
    !isStableId(value["stagingObjectId"])
  ) {
    return undefined;
  }

  const base = {
    schemaVersion: ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION,
    proposalId: value["proposalId"],
    runId: value["runId"],
    projectId: value["projectId"],
    toolCallId: value["toolCallId"],
    canonicalPayloadChecksum: value["canonicalPayloadChecksum"],
    operationKind,
    contentRootBindingId: value["contentRootBindingId"],
    pathPolicyRevision: value["pathPolicyRevision"],
    policyRevision: value["policyRevision"],
    capabilityRevision: value["capabilityRevision"],
    providerSemanticVersionSetChecksum: value["providerSemanticVersionSetChecksum"],
    approvalRuleSetVersion: value["approvalRuleSetVersion"],
    approvalRuleSetChecksum: value["approvalRuleSetChecksum"],
    relativeIdentity: relativePath.relativeIdentity,
    sourceRef: value["sourceRef"],
    targetRef: value["targetRef"],
    before: before.value,
    operationId: value["operationId"],
    stagingObjectId: value["stagingObjectId"]
  };

  if (!lifecycle) {
    if (!isOperationKind(operationKind)) return undefined;
    const candidate = validateEngineeringMutationCandidateImageV2(value["candidate"]);
    if (!candidate.ok) return undefined;
    const payload = {
      ...base,
      operationKind,
      candidate: candidate.value
    } as EngineeringRawMutationProposalPayloadV2;
    return proposalImagesAndRefsMatch(payload) ? freeze(payload) : undefined;
  }

  if (!isLifecycleOperationKind(operationKind)) return undefined;

  let targetRelativeIdentity: string | undefined;
  if (operationKind === "delete_file") {
    targetRelativeIdentity = value["targetRelativeIdentity"] === "" ? "" : undefined;
  } else {
    const targetPath = validateEngineeringRelativePath(value["targetRelativeIdentity"]);
    targetRelativeIdentity = targetPath.ok ? targetPath.relativeIdentity : undefined;
  }
  const targetProof = parseLifecycleTargetProof(value["targetProof"]);
  const deleteRecoveryValid =
    operationKind === "delete_file" &&
    isStableId(value["recoveryRootBindingId"]) &&
    isStableId(value["recoveryGrantRevision"]) &&
    isSha256(value["recoverySideEffectChecksum"]) &&
    isStableId(value["recoveryObjectId"]);
  const nonDeleteRecoveryEmpty =
    operationKind !== "delete_file" &&
    value["recoveryRootBindingId"] === null &&
    value["recoveryGrantRevision"] === null &&
    value["recoverySideEffectChecksum"] === null &&
    value["recoveryObjectId"] === null;
  if (
    targetRelativeIdentity === undefined ||
    (operationKind === "delete_file"
      ? targetProof === undefined || targetProof === null || targetProof.kind !== "absent"
      : targetProof === undefined || targetProof === null) ||
    (!deleteRecoveryValid && !nonDeleteRecoveryEmpty)
  ) {
    return undefined;
  }
  const payload = {
    ...base,
    operationKind,
    targetRelativeIdentity,
    targetProof: targetProof ?? null,
    recoveryRootBindingId: value["recoveryRootBindingId"] as string | null,
    recoveryGrantRevision: value["recoveryGrantRevision"] as string | null,
    recoverySideEffectChecksum: value["recoverySideEffectChecksum"] as string | null,
    recoveryObjectId: value["recoveryObjectId"] as string | null
  } as EngineeringLifecycleMutationProposalPayloadV2;

  return proposalImagesAndRefsMatch(payload) ? freeze(payload) : undefined;
}

function proposalImagesAndRefsMatch(payload: EngineeringMutationProposalPayloadV2): boolean {
  if (isLifecycleProposalPayload(payload)) {
    if (payload.operationKind === "create_directory") {
      return (
        payload.before.kind === "absent" &&
        payload.before.absenceProof.rootBindingId === payload.contentRootBindingId &&
        payload.before.absenceProof.relativeIdentity === payload.relativeIdentity &&
        payload.targetRelativeIdentity === payload.relativeIdentity &&
        payload.targetProof?.kind === "absent" &&
        payload.targetProof.relativeIdentity === payload.relativeIdentity &&
        isOpaqueRefKind(payload.sourceRef, "directory") &&
        isOpaqueRefKind(payload.targetRef, "directory")
      );
    }
    if (
      payload.before.kind !== "present" ||
      payload.before.manifest.identity.kind !== "observed_file" ||
      payload.before.manifest.identity.rootBindingId !== payload.contentRootBindingId ||
      payload.before.manifest.identity.relativeIdentity !== payload.relativeIdentity ||
      !doesEngineeringMutationBlobMatchManifestV2(
        payload.before.blob,
        payload.before.manifest,
        payload.contentRootBindingId
      ) ||
      !isOpaqueRefKind(payload.sourceRef, "file")
    ) {
      return false;
    }
    if (payload.operationKind === "delete_file") {
      return (
        payload.targetRelativeIdentity === "" &&
        payload.targetProof !== null &&
        payload.targetProof.kind === "absent" &&
        payload.targetProof.relativeIdentity === payload.relativeIdentity &&
        isOpaqueRefKind(payload.targetRef, "file")
      );
    }
    return (
      payload.targetProof !== null &&
      payload.targetProof.relativeIdentity === payload.targetRelativeIdentity &&
      isOpaqueRefKind(payload.targetRef, "directory")
    );
  }
  const candidate = payload.candidate;
  if (
    candidate.manifest.identity.kind !== "target" ||
    candidate.manifest.identity.rootBindingId !== payload.contentRootBindingId ||
    candidate.manifest.identity.relativeIdentity !== payload.relativeIdentity ||
    !doesEngineeringMutationBlobMatchManifestV2(
      candidate.blob,
      candidate.manifest,
      payload.contentRootBindingId
    )
  ) {
    return false;
  }

  if (payload.before.kind === "present") {
    if (
      payload.operationKind !== "replace_file" ||
      payload.before.manifest.identity.kind !== "observed_file" ||
      payload.before.manifest.identity.rootBindingId !== payload.contentRootBindingId ||
      payload.before.manifest.identity.relativeIdentity !== payload.relativeIdentity ||
      !doesEngineeringMutationBlobMatchManifestV2(
        payload.before.blob,
        payload.before.manifest,
        payload.contentRootBindingId
      )
    ) {
      return false;
    }
  } else if (
    payload.operationKind !== "create_file" ||
    payload.before.absenceProof.rootBindingId !== payload.contentRootBindingId ||
    payload.before.absenceProof.relativeIdentity !== payload.relativeIdentity
  ) {
    return false;
  }

  return payload.operationKind === "replace_file"
    ? isOpaqueRefKind(payload.sourceRef, "file") && isOpaqueRefKind(payload.targetRef, "file")
    : isOpaqueRefKind(payload.sourceRef, "directory") && isOpaqueRefKind(payload.targetRef, "file");
}

function parseRecord(value: unknown): EngineeringMutationProposalRecordV2 | undefined {
  if (!isRecord(value)) return undefined;
  const payloadKeys = isLifecycleOperationKind(value["operationKind"])
    ? lifecyclePayloadKeys
    : rawPayloadKeys;
  if (!hasExactKeys(value, [...payloadKeys, ...recordFieldKeys])) return undefined;
  const payload = parsePayload(pickPayload(value));
  const binding = parseChangeSetBinding(value["changeSetBinding"]);
  if (
    payload === undefined ||
    binding === undefined ||
    value["kind"] !== "engineering_mutation_proposal" ||
    !isSha256(value["proposalPayloadChecksum"]) ||
    value["proposalPayloadChecksum"] !== engineeringMutationProposalPayloadChecksumV2(payload) ||
    !isProposalStatus(value["status"]) ||
    !isCanonicalTimestamp(value["createdAt"]) ||
    !hasValidStateTimestamps(value["status"], value["rejectedAt"], value["appliedAt"]) ||
    !isSha256(value["recordChecksum"])
  ) {
    return undefined;
  }
  if (binding !== null && !binding.selectedOperationIds.includes(payload.operationId))
    return undefined;

  const unsigned = {
    ...payload,
    kind: "engineering_mutation_proposal" as const,
    proposalPayloadChecksum: value["proposalPayloadChecksum"],
    changeSetBinding: binding,
    status: value["status"],
    createdAt: value["createdAt"],
    rejectedAt: value["rejectedAt"],
    appliedAt: value["appliedAt"]
  } as Omit<EngineeringMutationProposalRecordV2, "recordChecksum">;
  if (value["recordChecksum"] !== engineeringMutationProposalRecordChecksumV2(unsigned)) {
    return undefined;
  }
  return freeze({
    ...unsigned,
    recordChecksum: value["recordChecksum"]
  } as EngineeringMutationProposalRecordV2);
}

function pickPayload(value: Record<string, unknown>): Record<string, unknown> {
  const keys = isLifecycleOperationKind(value["operationKind"])
    ? lifecyclePayloadKeys
    : rawPayloadKeys;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function parseLifecycleTargetProof(
  value: unknown
): EngineeringMutationLifecycleTargetProofV2 | null | undefined {
  if (value === null) return null;
  if (
    !hasExactKeys(value, lifecycleTargetProofKeys) ||
    value["schemaVersion"] !== ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION ||
    (value["kind"] !== "absent" && value["kind"] !== "same_object_case_only") ||
    !validateEngineeringRelativePath(value["relativeIdentity"]).ok ||
    !isStableId(value["parentDirectoryIdentity"]) ||
    !isSha256(value["proofChecksum"])
  ) {
    return undefined;
  }
  return freeze({ ...value }) as unknown as EngineeringMutationLifecycleTargetProofV2;
}

function parseChangeSetBinding(
  value: unknown
): EngineeringMutationProposalChangeSetBindingV2 | null | undefined {
  if (value === null) return null;
  if (!hasExactKeys(value, changeSetBindingKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION ||
    !isStableId(value["changeSetId"]) ||
    !isPositiveInteger(value["revision"]) ||
    !isSha256(value["checksum"]) ||
    !isSha256(value["displayBindingChecksum"]) ||
    !isSha256(value["selectionChecksum"]) ||
    !isSha256(value["operationOrderChecksum"]) ||
    !Array.isArray(value["selectedOperationIds"]) ||
    value["selectedOperationIds"].length === 0 ||
    value["selectedOperationIds"].some((id) => !isStableOperationId(id))
  ) {
    return undefined;
  }
  const selectedOperationIds = [...value["selectedOperationIds"]];
  if (new Set(selectedOperationIds).size !== selectedOperationIds.length) return undefined;
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION,
    changeSetId: value["changeSetId"],
    revision: value["revision"],
    checksum: value["checksum"],
    displayBindingChecksum: value["displayBindingChecksum"],
    selectionChecksum: value["selectionChecksum"],
    operationOrderChecksum: value["operationOrderChecksum"],
    selectedOperationIds: freeze(selectedOperationIds)
  } as EngineeringMutationProposalChangeSetBindingV2);
}

function parseRunToolCallLookup(
  value: unknown
): EngineeringMutationProposalRunToolCallLookupV2 | undefined {
  if (
    !hasExactKeys(value, runToolCallLookupKeys) ||
    !isStableId(value["runId"]) ||
    !isStableId(value["toolCallId"])
  ) {
    return undefined;
  }
  return freeze({ runId: value["runId"], toolCallId: value["toolCallId"] });
}

function parseBindInput(
  value: unknown
): EngineeringMutationProposalBindChangeSetInputV2 | undefined {
  if (
    !hasExactKeys(value, bindChangeSetKeys) ||
    !isStableId(value["proposalId"]) ||
    !isSha256(value["selectionChecksum"]) ||
    !isSha256(value["operationOrderChecksum"]) ||
    !Array.isArray(value["selectedOperationIds"]) ||
    value["selectedOperationIds"].length === 0 ||
    value["selectedOperationIds"].some((id) => !isStableOperationId(id))
  ) {
    return undefined;
  }
  const selectedOperationIds = [...value["selectedOperationIds"]];
  if (new Set(selectedOperationIds).size !== selectedOperationIds.length) return undefined;
  const changeSet = parseStrictChangeSet(value["changeSet"]);
  if (changeSet === undefined) return undefined;
  return freeze({
    proposalId: value["proposalId"],
    changeSet,
    selectionChecksum: value["selectionChecksum"],
    operationOrderChecksum: value["operationOrderChecksum"],
    selectedOperationIds: freeze(selectedOperationIds)
  } as EngineeringMutationProposalBindChangeSetInputV2);
}

function parseStrictChangeSet(value: unknown): ChangeSetV2 | undefined {
  try {
    return parseChangeSetV2(value);
  } catch {
    return undefined;
  }
}

function createChangeSetBinding(
  proposal: EngineeringMutationProposalRecordV2,
  input: EngineeringMutationProposalBindChangeSetInputV2
): EngineeringMutationProposalChangeSetBindingV2 | undefined {
  if (
    input.changeSet.runId !== proposal.runId ||
    input.changeSet.projectId !== proposal.projectId ||
    input.changeSet.providerSemanticVersionSetChecksum !==
      proposal.providerSemanticVersionSetChecksum ||
    !input.selectedOperationIds.includes(proposal.operationId)
  ) {
    return undefined;
  }
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION,
    changeSetId: input.changeSet.changeSetId,
    revision: input.changeSet.revision,
    checksum: input.changeSet.checksum,
    displayBindingChecksum: input.changeSet.displayBindingChecksum,
    selectionChecksum: input.selectionChecksum,
    operationOrderChecksum: input.operationOrderChecksum,
    selectedOperationIds: freeze([...input.selectedOperationIds])
  });
}

function createRecord(
  payload: EngineeringMutationProposalPayloadV2,
  createdAt: string
): EngineeringMutationProposalRecordV2 | undefined {
  if (!isCanonicalTimestamp(createdAt)) return undefined;
  const fields: EngineeringMutationProposalRecordFieldsV2 = {
    kind: "engineering_mutation_proposal",
    proposalPayloadChecksum: engineeringMutationProposalPayloadChecksumV2(payload),
    changeSetBinding: null,
    status: "proposed",
    createdAt,
    rejectedAt: null,
    appliedAt: null,
    recordChecksum: ""
  };
  return sealRecord({
    ...payload,
    ...fields
  } as Omit<EngineeringMutationProposalRecordV2, "recordChecksum">);
}

function sealRecord(
  value: Omit<EngineeringMutationProposalRecordV2, "recordChecksum">
): EngineeringMutationProposalRecordV2 {
  // Spread-based state transitions start from a persisted record. Strip its old checksum before
  // sealing the next envelope so mutable state is covered exactly once.
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "recordChecksum")
  ) as Omit<EngineeringMutationProposalRecordV2, "recordChecksum">;
  const record = {
    ...unsigned,
    recordChecksum: engineeringMutationProposalRecordChecksumV2(unsigned)
  } as EngineeringMutationProposalRecordV2;
  const parsed = parseRecord(record);
  if (parsed === undefined) throw new Error("ENGINEERING_MUTATION_PROPOSAL_RECORD_INVALID");
  return parsed;
}

function emptyScan(
  proposals: readonly EngineeringMutationProposalRecordV2[]
): EngineeringMutationProposalScanV2 {
  return freeze({
    schemaVersion: ENGINEERING_MUTATION_PROPOSAL_V2_SCHEMA_VERSION,
    proposals: freeze([...proposals].sort(compareProposal)),
    unknownObjectCount: 0,
    authenticationFailureCount: 0
  });
}

function compareProposal(
  left: EngineeringMutationProposalRecordV2,
  right: EngineeringMutationProposalRecordV2
): number {
  return left.proposalId.localeCompare(right.proposalId);
}

function runToolCallKey(runId: string, toolCallId: string): string {
  return `${runId}\u0000${toolCallId}`;
}

function diskKey(namespace: string, value: string): string {
  return `${namespace}-${sha256EngineeringMutationTextV2(value)}`;
}

function isDiskRecordName(value: string): boolean {
  return /^tool-call-[a-f0-9]{64}\.json$/u.test(value);
}

function isOpaqueRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:engineering_file_ref|engineering_directory_ref):[A-Za-z0-9_-]{22,128}$/u.test(value)
  );
}

function isOpaqueRefKind(value: string, kind: "file" | "directory"): boolean {
  return new RegExp(`^engineering_${kind}_ref:[A-Za-z0-9_-]{22,128}$`, "u").test(value);
}

function isOperationKind(value: unknown): value is EngineeringFileMutationOperationKindV2 {
  return value === "replace_file" || value === "create_file";
}

function isLifecycleOperationKind(
  value: unknown
): value is EngineeringFileLifecycleOperationKindV2 {
  return value === "move_file" || value === "delete_file" || value === "create_directory";
}

function isLifecycleProposalPayload(
  value: EngineeringMutationProposalPayloadV2
): value is EngineeringLifecycleMutationProposalPayloadV2 {
  return isLifecycleOperationKind(value.operationKind);
}

function isProposalStatus(value: unknown): value is EngineeringMutationProposalStatusV2 {
  return value === "proposed" || value === "rejected" || value === "applied";
}

function hasValidStateTimestamps(
  status: unknown,
  rejectedAt: unknown,
  appliedAt: unknown
): boolean {
  if (status === "proposed") return rejectedAt === null && appliedAt === null;
  if (status === "rejected") return isCanonicalTimestamp(rejectedAt) && appliedAt === null;
  return status === "applied" && rejectedAt === null && isCanonicalTimestamp(appliedAt);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isRuleSetVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u.test(value);
}

function isStableOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isOpaqueIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.normalize("NFC") === value &&
    !value.split("").some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function freeze<T>(value: T): T {
  if (ArrayBuffer.isView(value)) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function isMissing(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code?: unknown }).code === "ENOENT"
  );
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { readonly code?: unknown }).code === "EEXIST"
  );
}

function invalid<T = never>(
  code: string,
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering mutation proposal input is invalid.",
      suggestedAction: "Regenerate the Main-owned Engineering proposal from the current workspace.",
      traceId
    })
  );
}

function missing<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_PROPOSAL_NOT_FOUND",
      message: "The durable Engineering mutation proposal is unavailable.",
      suggestedAction: "Regenerate the proposal; do not infer an apply outcome from missing state.",
      traceId
    })
  );
}

function proposalIdConflict<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_MUTATION_PROPOSAL_ID_CONFLICT",
      message: "The proposal ID is already bound to another Engineering proposal.",
      suggestedAction: "Generate a new Main-owned proposal ID.",
      traceId
    })
  );
}

function toolCallConflict<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_MUTATION_PROPOSAL_TOOL_CALL_CONFLICT",
      message: "The tool call ID is already bound to a different canonical Engineering payload.",
      suggestedAction: "Issue a new tool call ID for the changed proposal.",
      traceId
    })
  );
}

function changeSetConflict<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_CONFLICT",
      message: "The proposal is already bound to a different Change Set 2.0 revision.",
      suggestedAction: "Regenerate the proposal and approval from the current Change Set.",
      traceId
    })
  );
}

function changeSetUnbound<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_UNBOUND",
      message:
        "An Engineering proposal cannot become applied without an exact Change Set 2.0 binding.",
      suggestedAction: "Bind the current Change Set and complete shared approval before applying.",
      traceId
    })
  );
}

function stateConflict<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    validationError({
      code: "ENGINEERING_MUTATION_PROPOSAL_STATE_CONFLICT",
      message: "A terminal Engineering proposal state cannot be changed.",
      suggestedAction:
        "Create a new proposal instead of changing an already rejected or applied one.",
      traceId
    })
  );
}

function clockInvalid<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_PROPOSAL_CLOCK_INVALID",
      message: "Main could not produce a canonical proposal timestamp.",
      suggestedAction: "Restore trusted Main time before preparing an Engineering mutation.",
      traceId
    })
  );
}

function unknownObject<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_PROPOSAL_UNKNOWN_OBJECT",
      message: "The Engineering proposal store contains an unrecognized durable object.",
      suggestedAction:
        "Enter recovery review; do not create or apply another Engineering mutation.",
      traceId
    })
  );
}

function authenticationFailure<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_PROPOSAL_AUTHENTICATION_FAILED",
      message: "An Engineering proposal record failed strict integrity validation.",
      suggestedAction: "Enter recovery review; do not use the affected proposal.",
      traceId
    })
  );
}

function durabilityUnavailable<T = never>(
  traceId = "engineering-mutation-proposal-repository-v2"
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_MUTATION_PROPOSAL_DURABILITY_UNQUALIFIED",
      message: "Qualified Main-owned Engineering proposal durability is unavailable.",
      suggestedAction: "Keep Engineering mutations disabled until qualified durability is wired.",
      traceId
    })
  );
}

function storageFailure<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code,
      message: "Engineering mutation proposal storage is unavailable.",
      suggestedAction: "Enter recovery review before retrying an Engineering mutation.",
      traceId
    })
  );
}

const commonPayloadKeys = [
  "approvalRuleSetChecksum",
  "approvalRuleSetVersion",
  "before",
  "canonicalPayloadChecksum",
  "capabilityRevision",
  "contentRootBindingId",
  "operationId",
  "operationKind",
  "pathPolicyRevision",
  "policyRevision",
  "projectId",
  "proposalId",
  "providerSemanticVersionSetChecksum",
  "relativeIdentity",
  "runId",
  "schemaVersion",
  "sourceRef",
  "stagingObjectId",
  "targetRef",
  "toolCallId"
] as const;

const rawPayloadKeys = [...commonPayloadKeys, "candidate"] as const;

const lifecyclePayloadKeys = [
  ...commonPayloadKeys,
  "recoveryGrantRevision",
  "recoveryObjectId",
  "recoveryRootBindingId",
  "recoverySideEffectChecksum",
  "targetProof",
  "targetRelativeIdentity"
] as const;

const recordFieldKeys = [
  "appliedAt",
  "changeSetBinding",
  "createdAt",
  "kind",
  "proposalPayloadChecksum",
  "recordChecksum",
  "rejectedAt",
  "status"
] as const;

const lifecycleTargetProofKeys = [
  "kind",
  "parentDirectoryIdentity",
  "proofChecksum",
  "relativeIdentity",
  "schemaVersion"
] as const;

const changeSetBindingKeys = [
  "changeSetId",
  "checksum",
  "displayBindingChecksum",
  "operationOrderChecksum",
  "revision",
  "schemaVersion",
  "selectedOperationIds",
  "selectionChecksum"
] as const;

const runToolCallLookupKeys = ["runId", "toolCallId"] as const;
const bindChangeSetKeys = [
  "changeSet",
  "operationOrderChecksum",
  "proposalId",
  "selectedOperationIds",
  "selectionChecksum"
] as const;
