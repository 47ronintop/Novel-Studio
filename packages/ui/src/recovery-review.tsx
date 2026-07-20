import { Check, Eye, RotateCcw, Trash2 } from "lucide-react";

import type { RecoveryReviewProps } from "./workspace-shell-types.js";

export function RecoveryReview(props: RecoveryReviewProps) {
  if (props.source === "chapter_autosave") {
    return <ChapterAutosaveRecoveryReview props={props} />;
  }
  return <AgentTransactionRecoveryReview props={props} />;
}

function ChapterAutosaveRecoveryReview({
  props
}: {
  readonly props: Extract<RecoveryReviewProps, { readonly source: "chapter_autosave" }>;
}) {
  const selectedDraft = props.recovery.review?.selectedDraft;
  return (
    <section className="ns-recovery-review" aria-label="章节恢复审阅">
      <header className="ns-recovery-review-header">
        <div>
          <span className="ns-review-kicker">Recovery</span>
          <h1>章节草稿恢复</h1>
        </div>
        <span className="ns-review-state">{props.recovery.review?.status ?? "idle"}</span>
      </header>
      <p className="ns-recovery-review-summary">
        自动保存草稿仍由原会话管理；预览、应用和丢弃不会改变 Agent 事务状态。
      </p>
      <div className="ns-recovery-review-items">
        {props.recovery.availableItems.map((item) => {
          const title =
            props.chapters.find((chapter) => chapter.id === item.chapterId)?.title ?? item.chapterId;
          return (
            <article className="ns-recovery-review-item" key={item.sessionId}>
              <div>
                <strong>{title}</strong>
                <span>{item.updatedAt}</span>
              </div>
              <div className="ns-inline-actions">
                <button
                  aria-label="预览恢复草稿"
                  onClick={() => props.onPreview(item.sessionId)}
                  type="button"
                >
                  <Eye aria-hidden="true" size={13} />
                  预览
                </button>
                <button
                  aria-label="应用恢复草稿"
                  onClick={() => props.onApply(item.sessionId)}
                  type="button"
                >
                  <Check aria-hidden="true" size={13} />
                  应用
                </button>
                <button
                  aria-label="丢弃恢复草稿"
                  onClick={() => props.onDiscard(item.sessionId)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                  丢弃
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {selectedDraft === undefined ? null : (
        <article className="ns-recovery-review-preview" aria-label="恢复草稿预览">
          <div>
            <strong>{selectedDraft.chapterTitle}</strong>
            <span>{selectedDraft.updatedAt}</span>
          </div>
          <pre>{selectedDraft.body}</pre>
        </article>
      )}
    </section>
  );
}

function AgentTransactionRecoveryReview({
  props
}: {
  readonly props: Extract<RecoveryReviewProps, { readonly source: "agent_transaction" }>;
}) {
  return (
    <section className="ns-recovery-review ns-agent-transaction-recovery" aria-label="Agent 事务恢复审阅">
      <header className="ns-recovery-review-header">
        <div>
          <span className="ns-review-kicker">Agent transaction</span>
          <h1>recovery_required</h1>
        </div>
        <span className="ns-review-state">需要恢复审阅</span>
      </header>
      <p className="ns-recovery-review-summary">部分事务已经落盘，但同步钩子失败。请使用既有撤销或重试路径。</p>
      <dl className="ns-recovery-facts">
        <div>
          <dt>运行</dt>
          <dd>{props.runId}</dd>
        </div>
        <div>
          <dt>错误</dt>
          <dd>{props.errorCode}</dd>
        </div>
        {props.versionGroupId === undefined ? null : (
          <div>
            <dt>Version Group</dt>
            <dd>{props.versionGroupId}</dd>
          </div>
        )}
        <div>
          <dt>说明</dt>
          <dd>{props.message}</dd>
        </div>
      </dl>
      {props.failedHooks.length === 0 ? null : (
        <ul className="ns-recovery-failed-hooks" aria-label="失败钩子">
          {props.failedHooks.map((hook) => (
            <li key={hook}>{hook}</li>
          ))}
        </ul>
      )}
      <div className="ns-inline-actions">
        {props.onOpenRollback === undefined ? null : (
          <button aria-label="打开撤销审阅" onClick={props.onOpenRollback} type="button">
            <RotateCcw aria-hidden="true" size={13} />
            打开撤销审阅
          </button>
        )}
        {props.onRetry === undefined ? null : (
          <button aria-label="重试 Agent 运行" onClick={props.onRetry} type="button">
            <RotateCcw aria-hidden="true" size={13} />
            重试 Agent 运行
          </button>
        )}
        {props.onOpenRollback === undefined && props.onRetry === undefined ? (
          <span className="ns-recovery-no-action">
            当前没有安全的自动恢复动作，请从运行诊断中查看后续处理。
          </span>
        ) : null}
      </div>
      <p className="ns-recovery-review-warning">
        recovery_required 不是成功状态；此处不会直接修改文件，也不会绕过 journal。
      </p>
    </section>
  );
}
