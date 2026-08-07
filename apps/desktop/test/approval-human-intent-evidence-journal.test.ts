import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";

import { ApprovalHumanIntentEvidenceJournal } from "../src/main/approval-human-intent-evidence-journal.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Main-only human intent evidence journal", () => {
  test("atomically issues once, rejects replay, and durably revokes without projection", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "approval-evidence-user-data-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "approval-evidence-project-"));
    roots.push(userDataRoot, projectRoot);
    const journal = new ApprovalHumanIntentEvidenceJournal({
      userDataRoot,
      now: () => "2026-08-06T00:00:00.000Z"
    });
    const evidence = sample();
    await expect(journal.issue(evidence)).resolves.toEqual({ ok: true, value: undefined });
    await expect(journal.issue(evidence)).resolves.toMatchObject({
      ok: false,
      error: { code: "APPROVAL_HUMAN_INTENT_EVIDENCE_REPLAY" }
    });
    await expect(journal.revoke(evidence.evidenceId, "modal_closed")).resolves.toEqual({
      ok: true,
      value: undefined
    });
    const scope = createHash("sha256")
      .update(`${evidence.workspaceBindingId}\n${evidence.rootBindingId}`, "utf8")
      .digest("hex");
    const stored = JSON.parse(
      await readFile(
        join(userDataRoot, "main-owned-approval-human-intent-evidence", scope, "intent_1.json"),
        "utf8"
      )
    );
    expect(stored).toMatchObject({
      state: "revoked",
      reason: "modal_closed",
      evidence: { source: "main_owned_isolated_modal_v1" }
    });
    await expect(
      access(join(projectRoot, "approval-human-intent-evidence", "intent_1.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects malformed evidence and unknown revocation identifiers", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "approval-evidence-user-data-"));
    roots.push(userDataRoot);
    const journal = new ApprovalHumanIntentEvidenceJournal({ userDataRoot });
    await expect(
      journal.issue({ ...sample(), source: "renderer" } as never)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "APPROVAL_HUMAN_INTENT_EVIDENCE_INVALID" }
    });
    await expect(journal.revoke("missing", "close")).resolves.toMatchObject({
      ok: false,
      error: { code: "APPROVAL_HUMAN_INTENT_EVIDENCE_NOT_FOUND" }
    });
  });
});

function sample() {
  return {
    schemaVersion: "1.0",
    source: "main_owned_isolated_modal_v1",
    evidenceId: "intent_1",
    authorizationId: "auth_1",
    previewId: "preview_1",
    action: "change_set",
    parentWebContentsId: 1,
    modalWebContentsId: 2,
    modalInstanceId: "modal_1",
    nonce: "nonce_1",
    createdAt: "2026-08-06T00:00:00.000Z",
    displayedAt: "2026-08-06T00:00:00.000Z",
    decidedAt: "2026-08-06T00:00:00.000Z",
    expiresAt: "2026-08-06T01:00:00.000Z",
    workspaceBindingId: "workspace_1",
    rootBindingId: "root_1",
    runId: "run_1",
    changeSetId: "change_1",
    changeSetRevision: 1,
    changeSetChecksum: "a".repeat(64),
    selectedOperationIds: ["op_1"],
    selectionChecksum: "b".repeat(64),
    operationOrderChecksum: "c".repeat(64),
    displayChecksum: "d".repeat(64),
    canonicalChecksum: "e".repeat(64),
    bindingChecksum: "f".repeat(64),
    approvalRuleSetVersion: "rules_1",
    approvalRuleSetChecksum: "1".repeat(64),
    capabilityRevision: "capability_1",
    policyRevision: "policy_1",
    bundleDigest: "2".repeat(64),
    qualificationRevision: "qualification_1",
    sourceRevision: "3".repeat(40),
    approvalArtifactManifestChecksum: "4".repeat(64),
    qualificationMatrixRevision: "matrix_1",
    qualificationMatrixChecksum: "5".repeat(64),
    automatedReportChecksum: "6".repeat(64),
    ownerApprovalId: "owner_1",
    ownerKeyId: "key_1",
    issuedAt: "2026-08-01T00:00:00.000Z",
    qualificationExpiresAt: "2026-09-01T00:00:00.000Z",
    attestationChecksum: "7".repeat(64)
  } as const;
}
