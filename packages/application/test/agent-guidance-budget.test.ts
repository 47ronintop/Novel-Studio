import { createHash } from "node:crypto";

import {
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  providerSemanticVersionSetChecksum
} from "@novel-studio/agent-engine";
import { describe, expect, test } from "vitest";

import {
  AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID,
  AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID,
  AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION,
  AGENT_GUIDANCE_BUDGET_SNAPSHOTS,
  AGENT_GUIDANCE_BUDGET_TOKEN_ESTIMATOR,
  AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT,
  AGENT_GUIDANCE_BUDGET_WRITING_TOKEN_LIMIT,
  agentGuidanceBudgetTokenLimit,
  assertAgentGuidanceBudgetWithinLimit,
  parseAgentGuidanceBudgetSnapshot,
  verifyAgentGuidanceBudgetSnapshot
} from "../src/agent-guidance-budget.js";

describe("Agent guidance budget", () => {
  test("enumerates every legal profile/mode with the maximal frozen authority input", () => {
    expect(Object.isFrozen(AGENT_GUIDANCE_BUDGET_SNAPSHOTS)).toBe(true);
    expect(
      AGENT_GUIDANCE_BUDGET_SNAPSHOTS.map(({ profileId, operationMode }) => [
        profileId,
        operationMode
      ])
    ).toEqual([
      ["standalone", "conversation"],
      ["writing", "planning"],
      ["writing", "execution"],
      ["creative_general", "planning"],
      ["creative_general", "execution"],
      ["engineering", "planning"],
      ["engineering", "execution"]
    ]);

    for (const snapshot of AGENT_GUIDANCE_BUDGET_SNAPSHOTS) {
      const facts = snapshot.normalizedInput.runtimeFacts;
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.normalizedInput)).toBe(true);
      expect(Object.isFrozen(facts)).toBe(true);
      expect(snapshot.estimatorId).toBe(AGENT_GUIDANCE_BUDGET_ESTIMATOR_ID);
      expect(snapshot.estimatorVersion).toBe(AGENT_GUIDANCE_BUDGET_ESTIMATOR_VERSION);
      expect(snapshot.estimatorProfileId).toBe(AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID);
      expect(snapshot.providerSemanticVersionSetChecksum).toBe(
        providerSemanticVersionSetChecksum(snapshot.normalizedInput.providerSemanticVersionSet)
      );
      expect(snapshot.materializedGuidanceChecksum).toBe(sha256(snapshot.materializedGuidance));
      expect(snapshot.tokenCount).toBe(
        AGENT_GUIDANCE_BUDGET_TOKEN_ESTIMATOR.count(
          snapshot.materializedGuidance,
          AGENT_GUIDANCE_BUDGET_ESTIMATOR_PROFILE_ID
        ).tokens
      );
      expect(snapshot.tokenCount).toBeLessThanOrEqual(snapshot.tokenLimit);
      expect(snapshot.tokenLimit).toBe(agentGuidanceBudgetTokenLimit(snapshot.profileId));
      expect(verifyAgentGuidanceBudgetSnapshot(snapshot)).toEqual(snapshot);

      if (snapshot.operationMode === "planning") {
        expect(facts.writeCapability).toBe("none");
        expect(facts.writingOperations).toEqual([]);
        expect(facts.workspaceFileOperations).toEqual([]);
        expect(facts.writeApprovalPolicy).toBe("not_applicable");
      }
      if (snapshot.operationMode === "execution") {
        expect(facts.approvalRuleSetVersion).toBe(DEFAULT_APPROVAL_RULE_SET_VERSION);
      }
      if (snapshot.operationMode === "execution" && snapshot.profileId === "writing") {
        expect(facts.writingOperations).toEqual([
          "chapter_replace",
          "chapter_create",
          "chapter_rename",
          "chapter_reorder",
          "chapter_status",
          "chapter_restore",
          "story_bible_create",
          "story_bible_patch",
          "story_bible_status",
          "story_bible_restore"
        ]);
        expect(facts.approvalRules).toHaveLength(facts.writingOperations.length);
      }
      if (
        snapshot.operationMode === "execution" &&
        (snapshot.profileId === "creative_general" || snapshot.profileId === "engineering")
      ) {
        expect(facts.workspaceFileOperations).toEqual([
          "replace_file",
          "create_file",
          "move_file",
          "delete_file",
          "create_directory"
        ]);
        expect(facts.approvalRules).toHaveLength(facts.workspaceFileOperations.length);
      }
    }
  });

  test("holds a checked-in release snapshot for estimator, version-set, input, body, and count", () => {
    expect(snapshotIdentities()).toEqual(EXPECTED_SNAPSHOT_IDENTITIES);
  });

  test("fails closed when a proof or body is no longer the registered materialization", () => {
    const snapshot = AGENT_GUIDANCE_BUDGET_SNAPSHOTS[2];
    if (snapshot === undefined) throw new Error("missing writing execution budget snapshot");
    expect(() =>
      parseAgentGuidanceBudgetSnapshot({
        ...snapshot,
        estimatorVersion: "guidance-budget-v2"
      })
    ).toThrow("AGENT_GUIDANCE_BUDGET_INVALID");
    expect(() =>
      parseAgentGuidanceBudgetSnapshot({
        ...snapshot,
        tokenCount: snapshot.tokenCount + 1
      })
    ).toThrow("AGENT_GUIDANCE_BUDGET_INVALID");
    expect(() =>
      parseAgentGuidanceBudgetSnapshot({
        ...snapshot,
        materializedGuidance: `${snapshot.materializedGuidance}\nforged authority`
      })
    ).toThrow("AGENT_GUIDANCE_BUDGET_INVALID");
    expect(() =>
      parseAgentGuidanceBudgetSnapshot({
        ...snapshot,
        normalizedInput: {
          ...snapshot.normalizedInput,
          providerSemanticVersionSet: {
            ...snapshot.normalizedInput.providerSemanticVersionSet,
            approvalRuleSetChecksum: "0".repeat(64)
          }
        }
      })
    ).toThrow("AGENT_GUIDANCE_BUDGET_INVALID");
  });

  test("uses hard profile caps rather than advisory limits", () => {
    expect(agentGuidanceBudgetTokenLimit("writing")).toBe(
      AGENT_GUIDANCE_BUDGET_WRITING_TOKEN_LIMIT
    );
    expect(agentGuidanceBudgetTokenLimit("standalone")).toBe(
      AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT
    );
    expect(agentGuidanceBudgetTokenLimit("creative_general")).toBe(
      AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT
    );
    expect(agentGuidanceBudgetTokenLimit("engineering")).toBe(
      AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT
    );
    expect(() =>
      assertAgentGuidanceBudgetWithinLimit("writing", AGENT_GUIDANCE_BUDGET_WRITING_TOKEN_LIMIT + 1)
    ).toThrow("AGENT_GUIDANCE_BUDGET_EXCEEDED");
    expect(() =>
      assertAgentGuidanceBudgetWithinLimit(
        "engineering",
        AGENT_GUIDANCE_BUDGET_WORKSPACE_TOKEN_LIMIT + 1
      )
    ).toThrow("AGENT_GUIDANCE_BUDGET_EXCEEDED");
  });
});

const EXPECTED_SNAPSHOT_IDENTITIES = [
  {
    caseId: "standalone-conversation-max",
    profileId: "standalone",
    operationMode: "conversation",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "3e0aa9653f1ed914f3e19064addc788944f2d028118b4c78edb12884cf4f561e",
    normalizedInputChecksum: "fd29a6c78d2a989e69ab107f5386cbf53aeeded7f22b5e884d3fecea8d0b2912",
    materializedGuidanceChecksum:
      "85ea83b24f874649128556861d100cac1fa5f6b5db3e167e1f4b86871e40800d",
    tokenCount: 546,
    tokenLimit: 900,
    writingTaskIntent: null,
    writingOperations: [],
    workspaceFileOperations: [],
    writeApprovalPolicy: "not_applicable"
  },
  {
    caseId: "writing-planning-max",
    profileId: "writing",
    operationMode: "planning",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "f209e3d18c15d65b3806390cc461c08076d943c2c01ffee2bf8f5401a532cf02",
    normalizedInputChecksum: "85fe7ef758116f9f648ea9da1e96853fe7cadb5ae725fd43903e16c282dd18b7",
    materializedGuidanceChecksum:
      "1addd8bf3282d464a3f8ba8d863e0c4554c76bce8f89228e11ca2ea237aa4b3c",
    tokenCount: 761,
    tokenLimit: 1200,
    writingTaskIntent: {
      schemaVersion: "1.0",
      kind: "story_bible",
      bodyGeneration: false,
      source: "bounded_request_classifier"
    },
    writingOperations: [],
    workspaceFileOperations: [],
    writeApprovalPolicy: "not_applicable"
  },
  {
    caseId: "writing-execution-max",
    profileId: "writing",
    operationMode: "execution",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "5355b1561c4a34b11038e945ff08517b3fd1c2ce16319de31004557dc997db9d",
    normalizedInputChecksum: "f34c5a401ca264a515034f400fc4c95031dc6cafc63e43521d13aa194078fa07",
    materializedGuidanceChecksum:
      "7ddb06c913755e0f0eb7b578c680db5e13289b61927dfe232e65a1f7d2a564be",
    tokenCount: 1035,
    tokenLimit: 1200,
    writingTaskIntent: {
      schemaVersion: "1.0",
      kind: "story_bible",
      bodyGeneration: false,
      source: "bounded_request_classifier"
    },
    writingOperations: [
      "chapter_replace",
      "chapter_create",
      "chapter_rename",
      "chapter_reorder",
      "chapter_status",
      "chapter_restore",
      "story_bible_create",
      "story_bible_patch",
      "story_bible_status",
      "story_bible_restore"
    ],
    workspaceFileOperations: [],
    writeApprovalPolicy: "confirm_each_change_set"
  },
  {
    caseId: "creative-general-planning-max",
    profileId: "creative_general",
    operationMode: "planning",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "3e0aa9653f1ed914f3e19064addc788944f2d028118b4c78edb12884cf4f561e",
    normalizedInputChecksum: "e6a520dc7bfb4e5d5ac8892e083bbd3ebd197170a351faf9686a85bddd2fb8e2",
    materializedGuidanceChecksum:
      "5a38d44067df97f944a30f06ecd8411af2ff572d33e1825b1a6ccadbd4190d45",
    tokenCount: 649,
    tokenLimit: 900,
    writingTaskIntent: null,
    writingOperations: [],
    workspaceFileOperations: [],
    writeApprovalPolicy: "not_applicable"
  },
  {
    caseId: "creative-general-execution-max",
    profileId: "creative_general",
    operationMode: "execution",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "76136689cfd189b4d5398195625cf6475f5bfebfa98db1c6a4bcabe457409db6",
    normalizedInputChecksum: "bbad40da8b6943fa5ac160c3e634f68201766aa4fa90f8c1eb098caa87612d6b",
    materializedGuidanceChecksum:
      "7f0a79c6f9a42429b967375e67eba169cf42b744a662592b06d8d24188a13961",
    tokenCount: 783,
    tokenLimit: 900,
    writingTaskIntent: null,
    writingOperations: [],
    workspaceFileOperations: [
      "replace_file",
      "create_file",
      "move_file",
      "delete_file",
      "create_directory"
    ],
    writeApprovalPolicy: "confirm_each_change_set"
  },
  {
    caseId: "engineering-planning-max",
    profileId: "engineering",
    operationMode: "planning",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "3e0aa9653f1ed914f3e19064addc788944f2d028118b4c78edb12884cf4f561e",
    normalizedInputChecksum: "7cf11491b1bbdbf5a07685b24bf3c9e699cf8df880dee7dc3ec3bc80ded87981",
    materializedGuidanceChecksum:
      "6c80ba39c56a5a63e9cc542d2bf4a0bf5cf2b48615ee4275f8097bbaa8ca94b6",
    tokenCount: 709,
    tokenLimit: 900,
    writingTaskIntent: null,
    writingOperations: [],
    workspaceFileOperations: [],
    writeApprovalPolicy: "not_applicable"
  },
  {
    caseId: "engineering-execution-max",
    profileId: "engineering",
    operationMode: "execution",
    estimatorId: "agent-token-estimator",
    estimatorVersion: "guidance-budget-v1",
    estimatorProfileId: "guidance-budget-v1",
    providerSemanticVersionSetChecksum:
      "76136689cfd189b4d5398195625cf6475f5bfebfa98db1c6a4bcabe457409db6",
    normalizedInputChecksum: "59f9550d5457e23356d131d7a2230fd2008afeb2a30e03574c7e72e14f94f50b",
    materializedGuidanceChecksum:
      "c6b4b575881e2af54f9d2b47243f6d575dd0d35289251aa36bac7a076cd1787b",
    tokenCount: 843,
    tokenLimit: 900,
    writingTaskIntent: null,
    writingOperations: [],
    workspaceFileOperations: [
      "replace_file",
      "create_file",
      "move_file",
      "delete_file",
      "create_directory"
    ],
    writeApprovalPolicy: "confirm_each_change_set"
  }
] as const;

function snapshotIdentities(): readonly unknown[] {
  return AGENT_GUIDANCE_BUDGET_SNAPSHOTS.map((snapshot) => ({
    caseId: snapshot.caseId,
    profileId: snapshot.profileId,
    operationMode: snapshot.operationMode,
    estimatorId: snapshot.estimatorId,
    estimatorVersion: snapshot.estimatorVersion,
    estimatorProfileId: snapshot.estimatorProfileId,
    providerSemanticVersionSetChecksum: snapshot.providerSemanticVersionSetChecksum,
    normalizedInputChecksum: snapshot.normalizedInputChecksum,
    materializedGuidanceChecksum: snapshot.materializedGuidanceChecksum,
    tokenCount: snapshot.tokenCount,
    tokenLimit: snapshot.tokenLimit,
    writingTaskIntent: snapshot.normalizedInput.writingTaskIntent,
    writingOperations: snapshot.normalizedInput.runtimeFacts.writingOperations,
    workspaceFileOperations: snapshot.normalizedInput.runtimeFacts.workspaceFileOperations,
    writeApprovalPolicy: snapshot.normalizedInput.runtimeFacts.writeApprovalPolicy
  }));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
