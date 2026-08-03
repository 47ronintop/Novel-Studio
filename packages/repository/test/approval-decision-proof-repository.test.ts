import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM as packageApprovalRuleSetChecksum,
  DEFAULT_APPROVAL_RULE_SET_VERSION as packageApprovalRuleSetVersion,
  parseApprovalDecisionProofV1 as parsePackageApprovalDecisionProof
} from "@novel-studio/agent-engine";
import {
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
  DEFAULT_APPROVAL_RULE_SET_VERSION
} from "../../agent-engine/src/approval-rule-registry.js";
import {
  createMainOnlyApprovalDecisionProofV1,
  serializeApprovalDecisionProofV1,
  type ApprovalDecisionProofBindingV1
} from "../../agent-engine/src/approval-decision-proof.js";
import { ApprovalDecisionProofFileRepository } from "../src/approval-decision-proof-repository.js";

const roots: string[] = [];

describe("ApprovalDecisionProofFileRepository", () => {
  test("persists only canonical valid proofs at the bound run history path", async () => {
    const projectRoot = await createRoot();
    const repository = new ApprovalDecisionProofFileRepository({ projectRoot });
    const proof = validProof();

    expect(packageApprovalRuleSetVersion).toBe(DEFAULT_APPROVAL_RULE_SET_VERSION);
    expect(packageApprovalRuleSetChecksum).toBe(DEFAULT_APPROVAL_RULE_SET_CHECKSUM);
    expect(parsePackageApprovalDecisionProof(proof)).toEqual(proof);

    expect(await repository.writeApprovalDecisionProof("run_01", proof)).toEqual({
      ok: true,
      value: proof
    });
    expect(await repository.readApprovalDecisionProof("run_01", "proof_01")).toEqual({
      ok: true,
      value: proof
    });
    expect(
      await readFile(
        join(
          projectRoot,
          "history",
          "agent-runs",
          "run_01",
          "approval-decision-proofs",
          "proof_01.json"
        ),
        "utf8"
      )
    ).toBe(serializeApprovalDecisionProofV1(proof));
  });

  test("is idempotent only for the same canonical bytes and rejects a divergent body", async () => {
    const projectRoot = await createRoot();
    const repository = new ApprovalDecisionProofFileRepository({ projectRoot });
    const proof = validProof();

    await expect(repository.writeApprovalDecisionProof("run_01", proof)).resolves.toEqual({
      ok: true,
      value: proof
    });
    await expect(repository.writeApprovalDecisionProof("run_01", proof)).resolves.toEqual({
      ok: true,
      value: proof
    });

    const divergent = createMainOnlyApprovalDecisionProofV1({
      ...proof,
      binding: { ...proof.binding, capabilityRevision: "capability_02" }
    });
    expect(await repository.writeApprovalDecisionProof("run_01", divergent)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECISION_PROOF_CONFLICT" }
    });
  });

  test("validates safe IDs and exact run binding on write and read", async () => {
    const projectRoot = await createRoot();
    const repository = new ApprovalDecisionProofFileRepository({ projectRoot });
    const proof = validProof();

    expect(await repository.writeApprovalDecisionProof("../run", proof)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECISION_PROOF_INVALID" }
    });
    expect(await repository.writeApprovalDecisionProof("run_other", proof)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECISION_PROOF_INVALID" }
    });
    expect(await repository.readApprovalDecisionProof("run_01", "../proof")).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECISION_PROOF_INVALID" }
    });
  });

  test("fails closed on corrupt or noncanonical history records", async () => {
    const projectRoot = await createRoot();
    const repository = new ApprovalDecisionProofFileRepository({ projectRoot });
    const proof = validProof();
    const path = join(
      projectRoot,
      "history",
      "agent-runs",
      "run_01",
      "approval-decision-proofs",
      "proof_01.json"
    );

    await repository.writeApprovalDecisionProof("run_01", proof);
    await writeFile(path, `${serializeApprovalDecisionProofV1(proof)}\n`, "utf8");
    expect(await repository.readApprovalDecisionProof("run_01", "proof_01")).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECISION_PROOF_CORRUPT" }
    });
    expect(await repository.writeApprovalDecisionProof("run_01", proof)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_DECISION_PROOF_CORRUPT" }
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-approval-proof-"));
  roots.push(root);
  return root;
}

function validProof() {
  return createMainOnlyApprovalDecisionProofV1({
    proofId: "proof_01",
    approvalRuleSetVersion: DEFAULT_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
    operation: "chapter_replace",
    effectRuleId: "clean_chapter_body_v1",
    binding: binding(),
    evidence: {
      pathClass: "not_applicable",
      targetFreshness: "clean_stable",
      createOnly: "not_applicable",
      referenceImpact: "not_applicable",
      limits: "within",
      stateBoundary: "ordinary"
    }
  });
}

function binding(): ApprovalDecisionProofBindingV1 {
  return {
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    runId: "run_01",
    changeSetId: "change_set_01",
    changeSetRevision: 1,
    changeSetChecksum: "a".repeat(64),
    consistencyGroupChecksum: "b".repeat(64),
    proposalPayloadChecksum: "c".repeat(64),
    executionWritePolicy: "user_preapproved_run",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01"
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
