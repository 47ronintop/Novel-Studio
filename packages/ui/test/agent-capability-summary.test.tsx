// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { PermissionSummary } from "@novel-studio/application";

import {
  AgentCapabilitySummary,
  describeAgentCapabilities
} from "../src/agent-capability-summary.js";

describe("Agent capability summary", () => {
  test("uses the final engineering operation directory and keeps Shell/Git unavailable", () => {
    const summary = v2Summary({
      operationMode: "execution",
      workspaceKind: "engineeringWorkspace",
      workspaceFileOperations: ["replace_file", "create_file", "move_file", "delete_file"],
      proposalCapabilities: ["replace_file", "create_file", "move_file", "delete_file"],
      writeCapability: "propose",
      writeApprovalPolicy: "confirm_each_change_set",
      approvalRules: [
        { operation: "replace_file", reviewMode: "conditional_auto_review", effectRuleId: "ordinary_clean_file_replace_v1" },
        { operation: "create_file", reviewMode: "conditional_auto_review", effectRuleId: "ordinary_create_only_v1" },
        { operation: "move_file", reviewMode: "always_human" },
        { operation: "delete_file", reviewMode: "always_human" }
      ]
    });
    const facts = {
      profileId: "engineering" as const,
      operationMode: "execution" as const,
      contextMode: "general_file" as const,
      permissionSummary: summary
    };
    const description = describeAgentCapabilities(facts);

    expect(description.modeLabel).toBe("可提案 · 需审批");
    expect(description.workspaceFileOperations).toEqual([
      "replace_file",
      "create_file",
      "move_file",
      "delete_file"
    ]);
    expect(description.approvalRules).toHaveLength(4);
    expect(description.headline).toContain("无 Shell/任务/Git");

    const html = renderToStaticMarkup(<AgentCapabilitySummary facts={facts} />);
    expect(html).toContain("工程工作区");
    expect(html).toContain("文件替换");
    expect(html).toContain("文件移动/重命名");
    expect(html).toContain("目录审批规则");
    expect(html).toContain("普通干净文件替换");
    expect(html).toContain("不可用：Shell、Git、任务");
  });

  test("keeps a Plan read-only while exposing the future Act policy separately", () => {
    const facts = {
      profileId: "writing" as const,
      operationMode: "planning" as const,
      contextMode: "writing" as const,
      executionWritePolicy: "user_preapproved_run" as const,
      permissionSummary: v2Summary({
        operationMode: "planning",
        workspaceKind: "creativeProject",
        writeCapability: "none",
        writingOperations: [],
        workspaceFileOperations: [],
        proposalCapabilities: [],
        writeApprovalPolicy: "not_applicable",
        approvalRuleSetVersion: "not_applicable",
        approvalRuleSetChecksum: "not_applicable",
        approvalRules: []
      })
    };
    const html = renderToStaticMarkup(<AgentCapabilitySummary facts={facts} />);

    expect(html).toContain("只读规划");
    expect(html).toContain("当前 Plan：只读，无 mutation tools");
    expect(html).toContain("未来 Act 默认：有限替我审批");
    expect(html).not.toContain("可提案 · 本次运行有限预授权");
  });

  test("renders proposal-level proof requirements and target blockers when supplied", () => {
    const facts = {
      profileId: "creative_general" as const,
      operationMode: "execution" as const,
      contextMode: "general_file" as const,
      permissionSummary: v2Summary({
        workspaceKind: "creativeProject",
        workspaceFileOperations: ["replace_file"],
        proposalCapabilities: ["replace_file"],
        writeCapability: "propose",
        writeApprovalPolicy: "limited_run_preapproval",
        approvalRules: [
          {
            operation: "replace_file",
            reviewMode: "conditional_auto_review",
            effectRuleId: "ordinary_clean_file_replace_v1"
          }
        ]
      }),
      proposalApprovals: [
        {
          operation: "replace_file",
          approvalRequirement: "human_confirmation" as const,
          reasonCodes: ["target_not_clean_or_stable"]
        }
      ]
    };
    const html = renderToStaticMarkup(
      <AgentCapabilitySummary facts={facts} blockedTargets={["notes/draft.md · 未保存"]} />
    );

    expect(html).toContain("本次运行有限预授权");
    expect(html).toContain("本组提案审批");
    expect(html).toContain("需人工确认");
    expect(html).toContain("目标未保持干净且稳定");
    expect(html).toContain("写入受阻：notes/draft.md · 未保存");
  });
});

function v2Summary(overrides: Record<string, unknown> = {}): PermissionSummary {
  return {
    schemaVersion: "2.0",
    permissionSummaryId: "permission_01",
    projectId: "project_01",
    runDraftId: "draft_01",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    toolRegistryRevision: "registry_01",
    rootFingerprint: "root_01",
    readCapabilities: ["list_project_entries", "read_project_file"],
    proposalCapabilities: [],
    forbiddenCapabilities: ["shell", "git"],
    generatedAt: "2026-08-05T00:00:00.000Z",
    workspaceKind: "creativeProject",
    operationMode: "execution",
    toolCatalogSchemaVersion: "2.0",
    descriptorRevision: "descriptor_01",
    providerMappingRevision: "mapping_01",
    featureFlagRevision: "flags_01",
    executeCapabilities: [],
    externalReadCapabilities: [],
    externalActionCapabilities: [],
    dataEgressCapabilities: [],
    allowedCapabilities: ["read", "write"],
    writeMutationTrust: "unavailable",
    writeCapability: "none",
    writingOperations: [],
    workspaceFileOperations: [],
    writeApprovalPolicy: "not_applicable",
    approvalRuleSetVersion: "not_applicable",
    approvalRuleSetChecksum: "not_applicable",
    approvalRules: [],
    checksum: "a".repeat(64),
    ...overrides
  } as PermissionSummary;
}
