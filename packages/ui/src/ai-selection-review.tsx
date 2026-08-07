import { Check, RotateCcw, X } from "lucide-react";

import type { AiSelectionReviewProps } from "./workspace-shell-types.js";

export function AiSelectionReview({ review }: { readonly review: AiSelectionReviewProps }) {
  return (
    <section className="ns-ai-selection-review" aria-label="Selection AI review">
      <header className="ns-ai-observability-header">
        <span>Selection review</span>
        <span
          aria-label={review.status === "applied" ? "AI 修改已应用" : undefined}
          className={review.status === "applied" ? "ns-ai-applied-stamp" : undefined}
          data-status={review.status}
        >
          {review.status === "applied" ? "已应用" : review.status}
        </span>
      </header>
      <p className="ns-ai-context">
        Range {review.rangeLabel}: {review.compareLabel}
      </p>
      <div className="ns-selection-review-diff">
        <article>
          <h2>原文</h2>
          <p>{review.originalText}</p>
        </article>
        <article>
          <h2>建议</h2>
          <p>{review.proposedText}</p>
        </article>
      </div>
      {review.styleEvaluation !== undefined ? (
        <AiWritingStyleEvaluation evaluation={review.styleEvaluation} />
      ) : review.styleReview === undefined ? null : (
        <section className="ns-ai-style-review" aria-label="AI 文风规则检查">
          <div className="ns-ai-observability-header">
            <span>文风规则</span>
            <span>
              {review.styleReview.status === "clean"
                ? "未发现明显模板表达"
                : `文风规则命中 ${review.styleReview.hitCount} 处`}
            </span>
          </div>
          {review.styleReview.hits.length === 0 ? null : (
            <ul className="ns-ai-style-hit-list">
              {review.styleReview.hits.map((hit, index) => (
                <li className="ns-ai-style-hit" key={`${hit.ruleId}-${hit.positionLabel}-${index}`}>
                  <div>
                    <span>{hit.title}</span>
                    <span>{hit.positionLabel}</span>
                  </div>
                  <p>
                    <strong>{hit.matchedText}</strong>
                    <span>{hit.suggestion}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {review.diagnostic === undefined ? null : (
        <section className="ns-ai-failure" aria-label="失败诊断">
          <div className="ns-ai-observability-header">
            <strong>{review.diagnostic.title}</strong>
            <span>{review.diagnostic.recoverabilityLabel}</span>
          </div>
          <code>{review.diagnostic.code}</code>
          <p>{review.diagnostic.message}</p>
          <span>{review.diagnostic.suggestedAction}</span>
        </section>
      )}
      <div className="ns-ai-actions">
        <button
          aria-label="Accept selection AI preview"
          className="ns-icon-text-button"
          disabled={review.status !== "pending" || review.onAccept === undefined}
          onClick={review.onAccept}
          type="button"
        >
          <Check aria-hidden="true" size={14} />
          Accept
        </button>
        <button
          aria-label="Reject selection AI preview"
          className="ns-icon-text-button"
          disabled={review.status !== "pending" || review.onReject === undefined}
          onClick={review.onReject}
          type="button"
        >
          <X aria-hidden="true" size={14} />
          Reject
        </button>
        <button
          aria-label="Undo selection AI rejection"
          className="ns-icon-text-button"
          disabled={!review.canUndo || review.onUndo === undefined}
          onClick={review.onUndo}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
          Undo
        </button>
        {review.onRetry === undefined ? null : (
          <button
            aria-label="Retry selection AI preview"
            className="ns-icon-text-button"
            onClick={review.onRetry}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} />
            Retry
          </button>
        )}
      </div>
    </section>
  );
}

function AiWritingStyleEvaluation({
  evaluation
}: {
  readonly evaluation: NonNullable<AiSelectionReviewProps["styleEvaluation"]>;
}) {
  const prominentHits = evaluation.hits.filter(
    (hit) => hit.changeKind === "introduced" && hit.confidence !== "low" && !hit.defaultCollapsed
  );
  const collapsedHits = evaluation.hits.filter(
    (hit) => hit.defaultCollapsed || hit.changeKind === "pre_existing" || hit.confidence === "low"
  );

  return (
    <section className="ns-change-set-style-review" aria-label="AI 文风提醒">
      <header className="ns-change-set-style-review-header">
        <strong>文风检查</strong>
        <span>
          {prominentHits.length > 0 ? `新增 ${prominentHits.length} 条提醒` : "未发现新增提醒"}
        </span>
      </header>
      <p
        className="ns-change-set-style-review-advisory"
        role={prominentHits.length > 0 ? "status" : undefined}
      >
        这些是可能存在的文风问题，仅供参考；不会阻止接受或应用。
      </p>
      {prominentHits.length === 0 ? null : (
        <ul className="ns-change-set-style-review-list" aria-label="新增文风提醒">
          {prominentHits.map((hit) => (
            <AiWritingStyleEvaluationHit key={evaluationHitKey(hit)} hit={hit} />
          ))}
        </ul>
      )}
      {collapsedHits.length === 0 ? null : (
        <details className="ns-change-set-style-review-collapsed">
          <summary>查看已有或低置信度提醒（{collapsedHits.length}）</summary>
          <ul className="ns-change-set-style-review-list" aria-label="已有或低置信度文风提醒">
            {collapsedHits.map((hit) => (
              <AiWritingStyleEvaluationHit key={evaluationHitKey(hit)} hit={hit} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function AiWritingStyleEvaluationHit({
  hit
}: {
  readonly hit: NonNullable<AiSelectionReviewProps["styleEvaluation"]>["hits"][number];
}) {
  const kind = hit.changeKind === "introduced" ? "本次新增" : "原有内容";
  const confidence =
    hit.confidence === "high" ? "高置信度" : hit.confidence === "medium" ? "中置信度" : "低置信度";
  return (
    <li
      className="ns-change-set-style-review-hit"
      data-change-kind={hit.changeKind}
      data-confidence={hit.confidence}
    >
      <div>
        <strong>{hit.title}</strong>
        <span>{`${kind} · ${confidence}`}</span>
      </div>
      <p>
        <q>{hit.matchedText}</q>
        <span>{hit.suggestion}</span>
      </p>
      <small>{hit.excerpt.text}</small>
    </li>
  );
}

function evaluationHitKey(
  hit: NonNullable<AiSelectionReviewProps["styleEvaluation"]>["hits"][number]
): string {
  return `${hit.ruleId}-${hit.startOffset}-${hit.endOffset}-${hit.changeKind}`;
}
