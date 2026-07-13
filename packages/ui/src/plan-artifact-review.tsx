import { Check, X } from "lucide-react";

import type { PlanArtifact } from "@novel-studio/application";

export function PlanArtifactReview({
  plan,
  onDecision
}: {
  readonly plan: PlanArtifact;
  readonly onDecision: (decision: "approve" | "reject") => void;
}) {
  const blockingQuestions = plan.openQuestions.filter(
    (question) => question.blocking && question.resolution === undefined
  );
  const canDecide = plan.status === "ready";

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
            disabled={blockingQuestions.length > 0}
            onClick={() => onDecision("approve")}
            type="button"
          >
            <Check aria-hidden="true" size={14} />
            按此方案执行
          </button>
        </footer>
      ) : null}
    </section>
  );
}
