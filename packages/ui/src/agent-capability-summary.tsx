import type {
  AgentContextMode,
  AgentContextProfileId,
  AgentOperationMode,
  AgentWritePolicy
} from "@novel-studio/application";

import type {
  AgentCapabilityFacts,
  AgentProposalApprovalSummary
} from "./workspace-shell-types.js";

export interface AgentCapabilityDescription {
  readonly profileLabel: string;
  readonly modeLabel: string;
  readonly headline: string;
  readonly writingOperations: readonly string[];
  readonly workspaceFileOperations: readonly string[];
  readonly readCapabilities: readonly string[];
  readonly approvalRules: readonly AgentApprovalRuleDescription[];
  readonly forbiddenCapabilities: readonly string[];
  readonly networkRead: boolean;
  readonly remoteMcp: boolean;
  readonly limitedRunPreapproval: boolean;
  readonly futureActPolicyLabel?: string;
}

export interface AgentApprovalRuleDescription {
  readonly operation: string;
  readonly reviewLabel: string;
  readonly effectRuleLabel?: string;
}

export interface AgentCapabilitySummaryProps {
  readonly facts: AgentCapabilityFacts;
  readonly compact?: boolean;
  readonly ariaLabel?: string;
  readonly blockedTargets?: readonly string[];
}

/**
 * Formats the server-owned profile and Permission Summary without inventing capabilities.  V1/V1.1
 * summaries intentionally expose no operation-level claims; only a strict 2.0 summary can list
 * mutation operations or catalog approval rules.
 */
export function describeAgentCapabilities(
  facts: AgentCapabilityFacts
): AgentCapabilityDescription {
  const summary = facts.permissionSummary;
  const isV2 = summary?.schemaVersion === "2.0";
  const isV11 = summary?.schemaVersion === "1.1";
  const writingOperations = isV2 ? [...summary.writingOperations] : [];
  const workspaceFileOperations = isV2 ? [...summary.workspaceFileOperations] : [];
  const readCapabilities = summary === undefined ? [] : [...summary.readCapabilities];
  const approvalRules = isV2
    ? summary.approvalRules.map((rule) => ({
        operation: rule.operation,
        reviewLabel:
          rule.reviewMode === "always_human" ? "人工确认" : "条件审阅",
        ...(rule.reviewMode === "conditional_auto_review"
          ? { effectRuleLabel: effectRuleLabel(rule.effectRuleId) }
          : {})
      }))
    : [];
  const hasWrite = isV2
    ? summary.writeCapability === "propose" &&
      (writingOperations.length > 0 || workspaceFileOperations.length > 0)
    : (summary?.proposalCapabilities.length ?? 0) > 0;
  const limitedRunPreapproval =
    facts.operationMode === "execution" &&
    isV2 &&
    summary.writeApprovalPolicy === "limited_run_preapproval" &&
    approvalRules.some((rule) => rule.reviewLabel === "条件审阅");
  const modeLabel = capabilityModeLabel({
    profileId: facts.profileId,
    operationMode: facts.operationMode,
    hasWrite,
    limitedRunPreapproval
  });
  const profileLabel = profileLabelFor(facts.profileId);
  const forbiddenCapabilities = forbiddenLabels(summary?.forbiddenCapabilities ?? [], facts.profileId);
  const networkRead = isV2
    ? summary.allowedCapabilities.includes("network")
    : isV11 && summary.externalReadCapabilities.length > 0;
  const remoteMcp = isV2
    ? summary.allowedCapabilities.includes("remote_mcp")
    : isV11 && summary.externalActionCapabilities.some((value) =>
        value.toLowerCase().includes("mcp")
      );
  const futureActPolicyLabel =
    facts.operationMode === "planning" && facts.executionWritePolicy !== undefined
      ? futurePolicyLabel(facts.executionWritePolicy)
      : undefined;

  return {
    profileLabel,
    modeLabel,
    headline: headlineFor({
      profileId: facts.profileId,
      modeLabel,
      hasWrite,
      limitedRunPreapproval,
      writingOperations,
      workspaceFileOperations
    }),
    writingOperations,
    workspaceFileOperations,
    readCapabilities,
    approvalRules,
    forbiddenCapabilities,
    networkRead,
    remoteMcp,
    limitedRunPreapproval,
    ...(futureActPolicyLabel === undefined ? {} : { futureActPolicyLabel })
  };
}

export function profileLabelFor(profileId: AgentContextProfileId): string {
  switch (profileId) {
    case "standalone":
      return "Standalone";
    case "writing":
      return "创作工作台 · 写作";
    case "creative_general":
      return "创作项目 · 文件模式";
    case "engineering":
      return "工程工作区";
  }
}

export function capabilityModeLabel(input: {
  readonly profileId: AgentContextProfileId;
  readonly operationMode: AgentOperationMode;
  readonly hasWrite: boolean;
  readonly limitedRunPreapproval: boolean;
}): string {
  if (input.profileId === "standalone") return "Standalone · 不连接项目";
  if (input.operationMode === "planning") return "只读规划";
  if (!input.hasWrite) return "只读执行";
  return input.limitedRunPreapproval
    ? "可提案 · 本次运行有限预授权"
    : "可提案 · 需审批";
}

export function operationLabel(operation: string): string {
  switch (operation) {
    case "chapter_replace":
      return "章节正文替换";
    case "chapter_create":
      return "章节创建";
    case "chapter_rename":
      return "章节改名";
    case "chapter_reorder":
      return "章节排序";
    case "chapter_status":
      return "章节归档/状态";
    case "chapter_restore":
      return "章节删除恢复";
    case "story_bible_create":
      return "故事资料创建";
    case "story_bible_patch":
      return "故事资料修改";
    case "story_bible_status":
      return "故事资料归档/状态";
    case "story_bible_restore":
      return "故事资料删除恢复";
    case "replace_file":
      return "文件替换";
    case "create_file":
      return "文件创建";
    case "move_file":
      return "文件移动/重命名";
    case "delete_file":
      return "文件删除";
    case "create_directory":
      return "目录创建";
    default:
      return operation;
  }
}

export function approvalRequirementLabel(
  requirement: AgentProposalApprovalSummary["approvalRequirement"]
): string {
  switch (requirement) {
    case "auto_review_eligible":
      return "可条件审阅";
    case "human_confirmation":
      return "需人工确认";
    case "rejected":
      return "不可用";
  }
}

export function approvalReasonLabel(reason: string): string {
  switch (reason) {
    case "run_policy_requires_confirmation":
      return "运行策略要求确认";
    case "operation_always_human":
      return "该操作始终人工确认";
    case "target_not_clean_or_stable":
      return "目标未保持干净且稳定";
    case "path_requires_confirmation":
      return "路径需要确认";
    case "reference_impact":
      return "存在引用影响";
    case "state_boundary":
      return "触及状态边界";
    case "limit_exceeded":
      return "超出限制";
    case "mixed_or_incomplete_evidence":
      return "证据混合或不完整";
    case "operation_rejected":
      return "操作被拒绝";
    default:
      return reason;
  }
}

export function effectRuleLabel(effectRuleId: string): string {
  switch (effectRuleId) {
    case "clean_chapter_body_v1":
      return "干净章节正文";
    case "bounded_chapter_create_v1":
      return "受限章节创建";
    case "bounded_story_bible_create_v1":
      return "受限故事资料创建";
    case "no_reference_impact_story_bible_patch_v1":
      return "无引用影响的资料修改";
    case "ordinary_clean_file_replace_v1":
      return "普通干净文件替换";
    case "ordinary_create_only_v1":
      return "普通仅创建文件";
    default:
      return effectRuleId;
  }
}

export function AgentCapabilitySummary({
  facts,
  compact = false,
  ariaLabel = "Agent 能力摘要",
  blockedTargets = []
}: AgentCapabilitySummaryProps) {
  const description = describeAgentCapabilities(facts);
  const blocked = [...new Set(blockedTargets)].filter((target) => target.length > 0);
  if (compact) {
    return (
      <section
        aria-label={ariaLabel}
        className="ns-agent-capability-summary ns-agent-capability-summary-compact"
        data-profile={facts.profileId}
      >
        <div className="ns-agent-capability-summary-heading">
          <strong>{description.profileLabel}</strong>
          <span>{description.modeLabel}</span>
        </div>
        <p>{description.headline}</p>
      </section>
    );
  }

  return (
    <section
      aria-label={ariaLabel}
      className="ns-agent-capability-summary"
      data-profile={facts.profileId}
    >
      <div className="ns-agent-capability-summary-heading">
        <strong>{description.profileLabel}</strong>
        <span>{description.modeLabel}</span>
      </div>
      <p>{description.headline}</p>
      {facts.operationMode === "planning" ? (
        <p className="ns-agent-capability-summary-note">当前 Plan：只读，无 mutation tools。</p>
      ) : null}
      {description.futureActPolicyLabel === undefined ? null : (
        <p className="ns-agent-capability-summary-note">
          未来 Act 默认：{description.futureActPolicyLabel}；进入执行边界时重新确认。
        </p>
      )}
      {description.writingOperations.length > 0 ? (
        <CapabilityList label="已公开写作操作" values={description.writingOperations} />
      ) : null}
      {description.workspaceFileOperations.length > 0 ? (
        <CapabilityList label="已公开文件操作" values={description.workspaceFileOperations} />
      ) : null}
      {description.approvalRules.length > 0 ? (
        <section aria-label="目录审批规则" className="ns-agent-capability-rules">
          <strong>目录审批规则</strong>
          <ul>
            {description.approvalRules.map((rule) => (
              <li key={rule.operation}>
                {operationLabel(rule.operation)} · {rule.reviewLabel}
                {rule.effectRuleLabel === undefined ? "" : ` · ${rule.effectRuleLabel}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {facts.proposalApprovals === undefined || facts.proposalApprovals.length === 0 ? null : (
        <section aria-label="提案审批结果" className="ns-agent-capability-rules">
          <strong>本组提案审批</strong>
          <ul>
            {facts.proposalApprovals.map((approval, index) => (
              <li key={`${approval.operation}-${index}`}>
                {operationLabel(approval.operation)} · {approvalRequirementLabel(approval.approvalRequirement)}
                {approval.reasonCodes.length === 0
                  ? ""
                  : ` · ${approval.reasonCodes.map(approvalReasonLabel).join("、")}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {description.readCapabilities.length > 0 ? (
        <CapabilityList label="已公开读取能力" values={description.readCapabilities} />
      ) : null}
      {description.networkRead ? <p>网络读取：已公开</p> : null}
      {description.remoteMcp ? <p>远程 MCP：已公开</p> : null}
      {description.forbiddenCapabilities.length > 0 ? (
        <p className="ns-agent-capability-summary-denied">
          不可用：{description.forbiddenCapabilities.join("、")}
        </p>
      ) : null}
      {blocked.length === 0 ? null : (
        <p className="ns-agent-capability-summary-blocked">
          写入受阻：{blocked.join("、")}
        </p>
      )}
    </section>
  );
}

function CapabilityList({ label, values }: { readonly label: string; readonly values: readonly string[] }) {
  return (
    <section aria-label={label} className="ns-agent-capability-list">
      <strong>{label}</strong>
      <ul>
        {values.map((value) => (
          <li key={value}>{operationLabel(value)}</li>
        ))}
      </ul>
    </section>
  );
}

function profileLabelPrefix(profileId: AgentContextProfileId): string {
  switch (profileId) {
    case "standalone":
      return "Standalone";
    case "writing":
      return "写作";
    case "creative_general":
      return "创作项目 · 文件模式";
    case "engineering":
      return "工程工作区";
  }
}

function headlineFor(input: {
  readonly profileId: AgentContextProfileId;
  readonly modeLabel: string;
  readonly hasWrite: boolean;
  readonly limitedRunPreapproval: boolean;
  readonly writingOperations: readonly string[];
  readonly workspaceFileOperations: readonly string[];
}): string {
  if (input.profileId === "standalone") return "Standalone · 不连接项目";
  if (!input.hasWrite) {
    return `${profileLabelPrefix(input.profileId)} · ${input.modeLabel}${
      input.profileId === "engineering" ? " · 无 Shell/任务/Git" : ""
    }`;
  }
  const approval = input.limitedRunPreapproval ? "本次运行有限预授权" : "需审批";
  if (input.profileId === "writing") {
    return `写作 · ${writingHeadline(input.writingOperations)} · ${approval}`;
  }
  return `工程工作区 · ${fileHeadline(input.workspaceFileOperations)} · ${approval} · 无 Shell/任务/Git`;
}

function writingHeadline(operations: readonly string[]): string {
  const chapter = operations.filter((operation) => operation.startsWith("chapter_"));
  const storyBible = operations.filter((operation) => operation.startsWith("story_bible_"));
  if (chapter.length > 0 && storyBible.length > 0) {
    return "章节/资料可查增改、可归档与删除恢复";
  }
  return operations.map(operationLabel).join("、");
}

function fileHeadline(operations: readonly string[]): string {
  const labels = new Set(operations);
  if (
    labels.has("replace_file") &&
    labels.has("create_file") &&
    labels.has("delete_file") &&
    labels.has("move_file")
  ) {
    return "可提案文件查/增/改/删/移动与重命名";
  }
  return operations.map(operationLabel).join("、");
}

function futurePolicyLabel(policy: AgentWritePolicy): string {
  return policy === "user_preapproved_run" ? "有限替我审批" : "请求批准";
}

function forbiddenLabels(
  capabilities: readonly string[],
  profileId: AgentContextProfileId
): readonly string[] {
  const labels = new Set<string>();
  for (const capability of capabilities) {
    if (capability.startsWith("operation:")) {
      labels.add(`${operationLabel(capability.slice("operation:".length))}不可用`);
      continue;
    }
    switch (capability) {
      case "shell":
        labels.add("Shell");
        break;
      case "git":
        labels.add("Git");
        break;
      case "network":
        labels.add("网络");
        break;
      case "remote_mcp":
        labels.add("远程 MCP");
        break;
      default:
        labels.add(capability);
    }
  }
  if (profileId === "engineering") {
    labels.add("Shell");
    labels.add("任务");
    labels.add("Git");
  }
  return [...labels];
}

export function contextProfileIdFor(
  contextMode: AgentContextMode,
  workspaceKind: "creativeProject" | "engineeringWorkspace" | undefined
): AgentContextProfileId {
  if (contextMode === "standalone_chat") return "standalone";
  if (workspaceKind === "engineeringWorkspace") return "engineering";
  return contextMode === "writing" ? "writing" : "creative_general";
}
