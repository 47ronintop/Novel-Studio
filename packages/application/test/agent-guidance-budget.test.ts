import { createHash } from "node:crypto";

import { providerSemanticVersionSetChecksum } from "@novel-studio/agent-engine";
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
      "f09332ce1d700c78223cad0a95b818d8835992bc4d79f5c0ca473ad99009ccb6",
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
      "3193baa397c01d99d361d31dc0841d7bcd836807173278405c9253f8698cc28e",
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
      "74d95ed4166621dcf88e51101385659020691b3eb23b38877b40a36b4263f5be",
    normalizedInputChecksum: "c296a11c8c661f4ecdcff9a193a1b51002e93946588e78385e557c09b569f9b0",
    materializedGuidanceChecksum:
      "f7052075affaf54421428258e22856e5f8a053f995105d213a6ca2bf4cbf6bf2",
    tokenCount: 975,
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
      "21d1a5c5f89dfc45789fef45bd69c082f55cbdbcf32d8ff9f2e0d29f6b630f80",
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
      "e2a89d8ea3b323cc2d51e375424ea5cb73c1ca32af726deccc74a52beffba86f",
    normalizedInputChecksum: "90c03b2b47177a2b54e6733d26019d939d1fb58800e90e83551e0f2b8e55f487",
    materializedGuidanceChecksum:
      "57d8d6c4e02cc1ea9b29a15ba2afb9725f91a7d969c4ef1abad4799990530fda",
    tokenCount: 754,
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
      "203f7c60fbcaf66737553e6b2d272ec216ad27a28d586bfd68c4974d14827fba",
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
      "e2a89d8ea3b323cc2d51e375424ea5cb73c1ca32af726deccc74a52beffba86f",
    normalizedInputChecksum: "dbd16ce427e76e47f166c0a9175eb68fd2c8a08c30db182b32225bb8b3b259eb",
    materializedGuidanceChecksum:
      "76c5e070e2a3f0b04ff1ff71c278490b7c1adc3c92eb050d2f3114889e37fa0e",
    tokenCount: 813,
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
