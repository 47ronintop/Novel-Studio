import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgentContextMode, AgentWritePolicy, PlanArtifact } from "@novel-studio/application";
import type { AgentPlanExecutionOptions } from "./workspace-shell-types.js";

export interface PlanArtifactReviewProps {
  readonly contextMode: AgentContextMode;
  readonly plan: PlanArtifact;
  readonly onDecision: (
    decision: "approve" | "reject",
    execution?: AgentPlanExecutionOptions
  ) => void;
}

export function PlanArtifactReview({
  contextMode,
  plan,
  onDecision
}: PlanArtifactReviewProps) {
  const [executionContextMode, setExecutionContextMode] =
    useState<AgentContextMode>(contextMode);
  const [executionWritePolicy, setExecutionWritePolicy] =
    useState<AgentWritePolicy>("write_before_confirmation");
  const [executionWritePolicyAcknowledged, setExecutionWritePolicyAcknowledged] =
    useState(false);
  const blockingQuestions = plan.openQuestions.filter(
    (question) => question.blocking && question.resolution === undefined
  );
  const canDecide = plan.status === "ready";
  const automaticWriteSelected = executionWritePolicy === "user_preapproved_run";

  useEffect(() => {
    setExecutionContextMode(contextMode);
    setExecutionWritePolicy("write_before_confirmation");
    setExecutionWritePolicyAcknowledged(false);
  }, [contextMode, plan.planId, plan.revision]);

  function selectWritePolicy(policy: AgentWritePolicy): void {
    setExecutionWritePolicy(policy);
    if (policy === "write_before_confirmation") {
      setExecutionWritePolicyAcknowledged(false);
    }
  }

  return (
    <section className="ns-plan-review" aria-label="Plan Artifact 审阅">
      <header>
        <div>
          <strong>计划 v{plan.revision}</strong>
          <span>{plan.steps.length} 个步骤</span>
        </div>
        <span>只读规划</span>
      </header>
      <h3>{plan.goal}</h3>
      <ol>
        {plan.steps.map((step) => (
          <li key={step.stepId}>
            <strong>{step.title}</strong>
            <span>{step.verification}</span>
          </li>
        ))}
      </ol>
      {blockingQuestions.length === 0 ? null : (
        <div className="ns-plan-blockers" role="status">
          <strong>仍有阻塞问题</strong>
          {blockingQuestions.map((question) => (
            <span key={question.questionId}>{question.prompt}</span>
          ))}
        </div>
      )}
      {canDecide ? (
        <>
          <section className="ns-agent-write-policy" aria-label="计划执行写入策略">
            <div className="ns-agent-write-policy-heading">
              <span>执行该计划可能修改项目文件；自动修改授权仅适用于本次运行。</span>
            </div>
            <fieldset>
              <legend>执行上下文</legend>
              <label>
                <input
                  checked={executionContextMode === "writing"}
                  name={`agent-plan-context-mode-${plan.planId}-${plan.revision}`}
                  onChange={() => setExecutionContextMode("writing")}
                  type="radio"
                />
                <span>写作</span>
              </label>
              <label>
                <input
                  checked={executionContextMode === "general_file"}
                  name={`agent-plan-context-mode-${plan.planId}-${plan.revision}`}
                  onChange={() => setExecutionContextMode("general_file")}
                  type="radio"
                />
                <span>通用文件</span>
              </label>
            </fieldset>
            <fieldset>
              <legend>执行写入策略</legend>
              <label>
                <input
                  checked={executionWritePolicy === "write_before_confirmation"}
                  name={`agent-plan-write-policy-${plan.planId}-${plan.revision}`}
                  onChange={() => selectWritePolicy("write_before_confirmation")}
                  type="radio"
                />
                <span>每次修改前确认</span>
              </label>
              <label>
                <input
                  checked={automaticWriteSelected}
                  name={`agent-plan-write-policy-${plan.planId}-${plan.revision}`}
                  onChange={() => selectWritePolicy("user_preapproved_run")}
                  type="radio"
                />
                <span>本次运行自动修改</span>
              </label>
            </fieldset>
            {!automaticWriteSelected ? null : (
              <label className="ns-agent-write-acknowledgement">
                <input
                  checked={executionWritePolicyAcknowledged}
                  onChange={(event) =>
                    setExecutionWritePolicyAcknowledged(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>我理解本次运行可自动修改项目文件，并会在写入前创建 Version Group。</span>
              </label>
            )}
          </section>
          <footer>
            <button
              aria-label="拒绝计划"
              className="ns-ai-secondary-button"
              onClick={() => onDecision("reject")}
              type="button"
            >
              <X aria-hidden="true" size={14} />
              拒绝计划
            </button>
            <button
              aria-label="按此方案执行"
              className="ns-ai-send-button ns-agent-plan-approve"
              disabled={
                blockingQuestions.length > 0 ||
                (automaticWriteSelected && !executionWritePolicyAcknowledged)
              }
              onClick={() =>
                onDecision("approve", {
                  executionContextMode,
                  executionWritePolicy,
                  ...(automaticWriteSelected && executionWritePolicyAcknowledged
                    ? { executionWritePolicyAcknowledged: true }
                    : {})
                })
              }
              type="button"
            >
              <Check aria-hidden="true" size={14} />
              按此方案执行
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}
