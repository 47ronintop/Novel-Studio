import { Check, RotateCcw, X } from "lucide-react";

import type { AiSelectionReviewProps } from "./workspace-shell-types.js";

export function AiSelectionReview({ review }: { readonly review: AiSelectionReviewProps }) {
  return (
    <section className="ns-ai-selection-review" aria-label="Selection AI review">
      <header className="ns-ai-observability-header">
        <span>Selection review</span>
        <span>{review.status}</span>
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
      {review.styleReview === undefined ? null : (
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
          <button aria-label="Retry selection AI preview" className="ns-icon-text-button" onClick={review.onRetry} type="button">
            <RotateCcw aria-hidden="true" size={14} />
            Retry
          </button>
        )}
      </div>
    </section>
  );
}
