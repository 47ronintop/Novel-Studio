import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  MainOnlyHumanIntentEvidenceJournal,
  MainOnlyHumanIntentEvidenceV1
} from "./agent-approval-confirmation.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const HASH = /^[a-f0-9]{64}$/u;

interface StoredEvidence {
  readonly schemaVersion: "1.0";
  readonly state: "issued" | "revoked";
  readonly evidence: MainOnlyHumanIntentEvidenceV1;
  readonly checksum: string;
  readonly revokedAt?: string;
  readonly reason?: string;
}

/** Main-only durable evidence journal; it has no IPC/read projection API. */
export class ApprovalHumanIntentEvidenceJournal implements MainOnlyHumanIntentEvidenceJournal {
  public constructor(
    private readonly options: { readonly userDataRoot: string; readonly now?: () => string }
  ) {}

  public async issue(evidence: MainOnlyHumanIntentEvidenceV1): Promise<Result<void, UnifiedError>> {
    if (!isEvidence(evidence)) return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_INVALID");
    const directory = this.directory(evidence);
    const destination = join(directory, `${evidence.evidenceId}.json`);
    const payload: StoredEvidence = {
      schemaVersion: "1.0",
      state: "issued",
      evidence,
      checksum: checksum(evidence)
    };
    try {
      await mkdir(directory, { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "wx" });
      try {
        await link(temporary, destination); // atomic no-replace: a duplicate is a replay.
      } finally {
        await rm(temporary, { force: true });
      }
      return ok(undefined);
    } catch (cause) {
      if (isAlreadyExists(cause)) return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_REPLAY");
      return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_WRITE_FAILED");
    }
  }

  public async revoke(evidenceId: string, reason: string): Promise<Result<void, UnifiedError>> {
    if (!ID.test(evidenceId) || typeof reason !== "string" || reason.trim() === "") {
      return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_INVALID");
    }
    const path = join(this.directoryForKnownEvidence(evidenceId), `${evidenceId}.json`);
    let record: StoredEvidence;
    try {
      record = JSON.parse(await readFile(path, "utf8")) as StoredEvidence;
    } catch {
      return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_NOT_FOUND");
    }
    if (!isStored(record)) return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_TAMPERED");
    if (record.state === "revoked") return ok(undefined);
    const revoked: StoredEvidence = {
      ...record,
      state: "revoked",
      revokedAt: (this.options.now ?? (() => new Date().toISOString()))(),
      reason
    };
    try {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(revoked)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, path);
      return ok(undefined);
    } catch {
      return failure("APPROVAL_HUMAN_INTENT_EVIDENCE_WRITE_FAILED");
    }
  }

  private readonly evidenceDirectories = new Map<string, string>();

  private directory(evidence: MainOnlyHumanIntentEvidenceV1): string {
    const directory = join(
      this.options.userDataRoot,
      "main-owned-approval-human-intent-evidence",
      evidenceScopeChecksum(evidence)
    );
    this.evidenceDirectories.set(evidence.evidenceId, directory);
    return directory;
  }

  private directoryForKnownEvidence(evidenceId: string): string {
    // A coordinator can only revoke evidence that it issued in this Main process.  On restart it
    // has no live preview to revoke, and never searches project storage as a fallback.
    return this.evidenceDirectories.get(evidenceId) ?? join(this.options.userDataRoot, "missing");
  }
}

/**
 * Keeps evidence physically separated by the canonical bindings without putting either binding
 * (or an absolute project path) into a filesystem name below the Main-private user-data root.
 */
function evidenceScopeChecksum(
  evidence: Pick<MainOnlyHumanIntentEvidenceV1, "workspaceBindingId" | "rootBindingId">
): string {
  return createHash("sha256")
    .update(`${evidence.workspaceBindingId}\n${evidence.rootBindingId}`, "utf8")
    .digest("hex");
}

function isEvidence(value: unknown): value is MainOnlyHumanIntentEvidenceV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const required = [
    "schemaVersion",
    "source",
    "evidenceId",
    "authorizationId",
    "previewId",
    "action",
    "parentWebContentsId",
    "modalWebContentsId",
    "modalInstanceId",
    "nonce",
    "createdAt",
    "displayedAt",
    "decidedAt",
    "expiresAt",
    "workspaceBindingId",
    "rootBindingId",
    "runId",
    "changeSetId",
    "changeSetRevision",
    "changeSetChecksum",
    "selectedOperationIds",
    "selectionChecksum",
    "operationOrderChecksum",
    "displayChecksum",
    "canonicalChecksum",
    "bindingChecksum",
    "approvalRuleSetVersion",
    "approvalRuleSetChecksum",
    "capabilityRevision",
    "policyRevision",
    "bundleDigest",
    "qualificationRevision",
    "sourceRevision",
    "approvalArtifactManifestChecksum",
    "qualificationMatrixRevision",
    "qualificationMatrixChecksum",
    "automatedReportChecksum",
    "ownerApprovalId",
    "ownerKeyId",
    "issuedAt",
    "qualificationExpiresAt",
    "attestationChecksum"
  ];
  const optional = ["recoveryRootBindingId", "recoveryGrantRevision", "recoverySideEffectChecksum"];
  if (
    !Object.keys(v).every((key) => required.includes(key) || optional.includes(key)) ||
    !required.every((key) => key in v)
  )
    return false;
  const ids = [
    "evidenceId",
    "authorizationId",
    "previewId",
    "workspaceBindingId",
    "rootBindingId",
    "runId",
    "changeSetId",
    "modalInstanceId",
    "nonce",
    "approvalRuleSetVersion",
    "capabilityRevision",
    "policyRevision",
    "qualificationRevision",
    "qualificationMatrixRevision",
    "ownerApprovalId",
    "ownerKeyId"
  ];
  const dates = [
    "createdAt",
    "displayedAt",
    "decidedAt",
    "expiresAt",
    "issuedAt",
    "qualificationExpiresAt"
  ];
  return (
    v["schemaVersion"] === "1.0" &&
    v["source"] === "main_owned_isolated_modal_v1" &&
    (v["action"] === "plan_to_act" || v["action"] === "change_set") &&
    ids.every((key) => typeof v[key] === "string" && ID.test(v[key] as string)) &&
    typeof v["sourceRevision"] === "string" &&
    /^[a-f0-9]{40}$/u.test(v["sourceRevision"]) &&
    dates.every(
      (key) => typeof v[key] === "string" && Number.isFinite(Date.parse(v[key] as string))
    ) &&
    Number.isSafeInteger(v["parentWebContentsId"]) &&
    Number.isSafeInteger(v["modalWebContentsId"]) &&
    Number.isSafeInteger(v["changeSetRevision"]) &&
    (v["changeSetRevision"] as number) > 0 &&
    [
      "changeSetChecksum",
      "selectionChecksum",
      "operationOrderChecksum",
      "displayChecksum",
      "canonicalChecksum",
      "bindingChecksum",
      "approvalRuleSetChecksum",
      "bundleDigest",
      "approvalArtifactManifestChecksum",
      "qualificationMatrixChecksum",
      "automatedReportChecksum",
      "attestationChecksum"
    ].every((key) => typeof v[key] === "string" && HASH.test(v[key] as string)) &&
    Array.isArray(v["selectedOperationIds"]) &&
    (v["selectedOperationIds"] as unknown[]).every((id) => typeof id === "string" && ID.test(id))
  );
}

function isStored(value: unknown): value is StoredEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    (v["state"] === "issued" || v["state"] === "revoked") &&
    isEvidence(v["evidence"]) &&
    typeof v["checksum"] === "string" &&
    v["checksum"] === checksum(v["evidence"])
  );
}

function checksum(evidence: MainOnlyHumanIntentEvidenceV1): string {
  return createHash("sha256").update(JSON.stringify(evidence), "utf8").digest("hex");
}

function isAlreadyExists(cause: unknown): boolean {
  return (
    typeof cause === "object" && cause !== null && (cause as { code?: unknown }).code === "EEXIST"
  );
}

function failure(code: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "AgentError",
      message: "Human intent evidence journal rejected the operation.",
      recoverability: "user-action",
      suggestedAction: "Open a new confirmation.",
      traceId: "desktop-approval-human-intent-evidence"
    })
  );
}
