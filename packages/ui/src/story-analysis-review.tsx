import {
  AlertTriangle,
  Check,
  CheckCheck,
  FileDiff,
  Inbox,
  Play,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  X
} from "lucide-react";
import { useMemo, useState } from "react";

import type {
  StoryAnalysisIssueProps,
  StoryAnalysisReviewProps,
  StoryAnalysisSuggestionProps,
  StoryBibleChapterOption,
  StoryBibleEditorEntry
} from "./workspace-shell-types.js";

export interface StoryAnalysisReviewViewProps {
  readonly review: StoryAnalysisReviewProps;
  readonly entries: readonly StoryBibleEditorEntry[];
  readonly chapterOptions: readonly StoryBibleChapterOption[];
}

export function StoryAnalysisReviewView({
  review,
  entries,
  chapterOptions
}: StoryAnalysisReviewViewProps) {
  const [issueText, setIssueText] = useState<Record<string, string>>({});
  const entryTitles = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry.title] as const)),
    [entries]
  );
  const chapterTitles = useMemo(
    () => new Map(chapterOptions.map((chapter) => [chapter.id, chapter.title] as const)),
    [chapterOptions]
  );
  const busy = review.status !== "ready" && review.status !== "idle" && review.status !== "error";
  const domains = [...new Set(review.suggestions.map((suggestion) => suggestion.domain))].sort();
  const visibleSuggestions = review.suggestions.filter(
    (suggestion) =>
      review.filters.recordType !== "review_issue" &&
      (review.filters.status === "all" || suggestion.status === review.filters.status) &&
      (review.filters.domain === "all" || suggestion.domain === review.filters.domain)
  );
  const visibleIssues = review.issues.filter(
    (issue) =>
      review.filters.recordType !== "change" &&
      review.filters.domain === "all" &&
      (review.filters.status === "all" || issue.status === review.filters.status)
  );
  const selected = new Set(review.selectedSuggestionIds);
  const selectedSuggestions = review.suggestions.filter((suggestion) =>
    selected.has(suggestion.suggestionId)
  );
  const canAccept = selectedSuggestions.some((suggestion) => suggestion.status === "pending");
  const canReject =
    selectedSuggestions.length > 0 &&
    selectedSuggestions.every((suggestion) => suggestion.status === "pending");
  const canPrepare =
    selectedSuggestions.length > 0 &&
    selectedSuggestions.every((suggestion) => suggestion.status === "accepted");
  const groupedSuggestions = groupSuggestions(visibleSuggestions);

  return (
    <div className="ns-story-analysis-review" id="ns-story-analysis-review">
      <div className="ns-story-analysis-controls">
        <label className="ns-story-analysis-control">
          <span>章节</span>
          <select
            aria-label="选择资料分析记录"
            disabled={busy || review.summaries.length === 0}
            onChange={(event) => review.onRunSelect(event.currentTarget.value)}
            value={review.activeWorkflowRunId ?? ""}
          >
            {review.summaries.length === 0 ? <option value="">暂无记录</option> : null}
            {review.summaries.map((summary) => (
              <option key={summary.workflowRunId} value={summary.workflowRunId}>
                {chapterLabel(summary.chapterId, chapterTitles)} · {summary.pendingSuggestionCount}{" "}
                建议 / {summary.openIssueCount} 问题
              </option>
            ))}
          </select>
        </label>
        <label className="ns-story-analysis-control">
          <span>记录</span>
          <select
            aria-label="筛选资料分析记录类型"
            onChange={(event) =>
              review.onFiltersChange({
                recordType: event.currentTarget
                  .value as StoryAnalysisReviewProps["filters"]["recordType"]
              })
            }
            value={review.filters.recordType}
          >
            <option value="all">全部</option>
            <option value="change">变更建议</option>
            <option value="review_issue">一致性问题</option>
          </select>
        </label>
        <label className="ns-story-analysis-control">
          <span>状态</span>
          <select
            aria-label="筛选资料分析状态"
            onChange={(event) => review.onFiltersChange({ status: event.currentTarget.value })}
            value={review.filters.status}
          >
            <option value="all">全部</option>
            <option value="pending">待处理</option>
            <option value="accepted">已接受</option>
            <option value="applied">已应用</option>
            <option value="rejected">已拒绝</option>
            <option value="stale">已过期</option>
            <option value="failed">失败</option>
            <option value="open">待解决</option>
            <option value="resolved">已解决</option>
            <option value="dismissed">已忽略</option>
          </select>
        </label>
        <label className="ns-story-analysis-control">
          <span>领域</span>
          <select
            aria-label="筛选资料分析领域"
            onChange={(event) => review.onFiltersChange({ domain: event.currentTarget.value })}
            value={review.filters.domain}
          >
            <option value="all">全部</option>
            {domains.map((domain) => (
              <option key={domain} value={domain}>
                {domainLabel(domain)}
              </option>
            ))}
          </select>
        </label>
        <div className="ns-story-analysis-control-actions">
          <button
            aria-label="重新检查建议基线"
            className="ns-icon-button"
            disabled={busy || review.activeWorkflowRunId === undefined}
            onClick={review.onRefreshStaleness}
            title="重新检查建议基线"
            type="button"
          >
            <RefreshCcw aria-hidden="true" size={14} />
          </button>
          <button
            className="ns-icon-text-button"
            disabled={busy || review.activeChapterId === undefined}
            onClick={review.onReanalyze}
            type="button"
          >
            <Play aria-hidden="true" size={14} />
            重新分析
          </button>
        </div>
      </div>

      <section aria-label="章后资料分析设置" className="ns-story-analysis-settings">
        <div className="ns-story-analysis-setting-row">
          <div className="ns-story-analysis-settings-label">
            <Settings2 aria-hidden="true" size={14} />
            <span>章节完成后</span>
          </div>
          <div
            aria-label="章节完成后的资料分析方式"
            className="ns-segmented-control"
            role="radiogroup"
          >
            {(
              [
                ["off", "关闭"],
                ["prompt", "询问"],
                ["background-review", "后台分析"]
              ] as const
            ).map(([mode, label]) => (
              <button
                aria-checked={review.completionMode === mode}
                className="ns-segmented-control-option"
                data-active={review.completionMode === mode}
                disabled={busy}
                key={mode}
                onClick={() => review.onCompletionModeChange(mode)}
                role="radio"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="ns-story-analysis-setting-row">
          <div className="ns-story-analysis-settings-label">
            <ShieldCheck aria-hidden="true" size={14} />
            <span>资料写入方式</span>
          </div>
          <div
            aria-label="章后资料写入方式"
            className="ns-segmented-control"
            data-options="2"
            role="radiogroup"
          >
            {(
              [
                ["review", "审查后写入"],
                ["safe-auto", "安全自动更新"]
              ] as const
            ).map(([mode, label]) => (
              <button
                aria-checked={review.maintenanceMode === mode}
                className="ns-segmented-control-option"
                data-active={review.maintenanceMode === mode}
                disabled={busy}
                key={mode}
                onClick={() => review.onMaintenanceModeChange(mode)}
                role="radio"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="ns-story-analysis-settings-help">
          {review.maintenanceMode === "safe-auto"
            ? "只自动应用高置信度、无冲突且可撤销的安全更新；其余建议仍需审查。"
            : "当前需要确认后写入。进入下一章前若仍有未处理建议，系统会进行一次软提醒。"}
        </p>
      </section>

      {review.feedback === undefined ? null : (
        <div className="ns-story-analysis-feedback" data-kind={review.feedback.kind} role="status">
          {review.feedback.message}
        </div>
      )}

      {busy ? (
        <div className="ns-story-analysis-loading" role="status">
          <RefreshCcw aria-hidden="true" size={16} />
          {busyLabel(review.status)}
        </div>
      ) : review.summaries.length === 0 ? (
        <div className="ns-story-analysis-empty">
          <Inbox aria-hidden="true" size={20} />
          <span>暂无资料分析记录</span>
        </div>
      ) : (
        <div className="ns-story-analysis-content">
          <section aria-label="资料变更建议" className="ns-story-analysis-section">
            <div className="ns-story-analysis-section-header">
              <div>
                <strong>变更建议</strong>
                <span>{visibleSuggestions.length} 条</span>
              </div>
              <div className="ns-story-analysis-batch-actions">
                <span>{review.selectedSuggestionIds.length} 条已选</span>
                <button
                  className="ns-icon-text-button"
                  disabled={!canAccept || busy}
                  onClick={review.onAcceptSelected}
                  type="button"
                >
                  <Check aria-hidden="true" size={14} />
                  接受
                </button>
                <button
                  className="ns-icon-text-button"
                  disabled={!canReject || busy}
                  onClick={review.onRejectSelected}
                  type="button"
                >
                  <X aria-hidden="true" size={14} />
                  拒绝
                </button>
                <button
                  className="ns-primary-button ns-story-analysis-prepare"
                  disabled={!canPrepare || busy}
                  onClick={review.onPrepareSelected}
                  type="button"
                >
                  <FileDiff aria-hidden="true" size={14} />
                  生成变更预览
                </button>
              </div>
            </div>
            {groupedSuggestions.length === 0 ? (
              <div className="ns-story-analysis-empty compact">当前筛选下没有变更建议</div>
            ) : (
              <div className="ns-story-analysis-groups">
                {groupedSuggestions.map((group) => (
                  <SuggestionGroup
                    entryTitles={entryTitles}
                    group={group}
                    key={group.consistencyGroupId}
                    onToggle={review.onSuggestionToggle}
                    selected={selected}
                  />
                ))}
              </div>
            )}
          </section>

          {visibleIssues.length === 0 ? null : (
            <section aria-label="一致性问题" className="ns-story-analysis-section">
              <div className="ns-story-analysis-section-header">
                <div>
                  <strong>一致性问题</strong>
                  <span>{visibleIssues.length} 条</span>
                </div>
              </div>
              <div className="ns-story-analysis-issues">
                {visibleIssues.map((issue) => (
                  <IssueRow
                    issue={issue}
                    key={issue.issueId}
                    onDismiss={(reason) => review.onDismissIssue(issue.issueId, reason)}
                    onResolve={(decision) => review.onResolveIssue(issue.issueId, decision)}
                    onTextChange={(value) =>
                      setIssueText((current) => ({ ...current, [issue.issueId]: value }))
                    }
                    text={issueText[issue.issueId] ?? ""}
                  />
                ))}
              </div>
            </section>
          )}

          {review.preview === undefined ? null : (
            <section aria-label="资料更新变更预览" className="ns-story-analysis-preview">
              <div className="ns-story-analysis-section-header">
                <div>
                  <strong>变更预览</strong>
                  <span>Revision {review.preview.revision}</span>
                </div>
                <button
                  className="ns-primary-button"
                  disabled={busy || review.preview.files.some((file) => !file.valid)}
                  onClick={review.onApplyPrepared}
                  type="button"
                >
                  <ShieldCheck aria-hidden="true" size={14} />
                  确认并应用
                </button>
              </div>
              <ul className="ns-story-analysis-preview-files">
                {review.preview.files.map((file) => (
                  <li key={`${file.relativePath}:${file.consistencyGroupId ?? "ungrouped"}`}>
                    <FileDiff aria-hidden="true" size={14} />
                    <span>{file.relativePath}</span>
                    <small>{file.hunkCount} 处差异</small>
                    <span data-valid={file.valid}>{file.valid ? "验证通过" : "验证失败"}</span>
                  </li>
                ))}
                {review.preview.operations.map((operation) => (
                  <li key={operation.operationId}>
                    <FileDiff aria-hidden="true" size={14} />
                    <span>{operation.relativePath ?? operation.kind}</span>
                    <small>{operation.kind}</small>
                    <span data-valid="true">验证通过</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.result === undefined ? null : (
            <section aria-label="资料更新应用结果" className="ns-story-analysis-result">
              <div className="ns-story-analysis-section-header">
                <div>
                  <strong>分组结果</strong>
                  <span>{review.result.groups.length} 组</span>
                </div>
              </div>
              <ul>
                {review.result.groups.map((group) => (
                  <li key={group.consistencyGroupId} data-status={group.status}>
                    {group.status === "applied" ? (
                      <CheckCheck aria-hidden="true" size={15} />
                    ) : (
                      <AlertTriangle aria-hidden="true" size={15} />
                    )}
                    <div>
                      <strong>{shortGroupId(group.consistencyGroupId)}</strong>
                      <span>
                        {applyStatusLabel(group.status)} · {group.suggestionIds.length} 条建议
                      </span>
                      {group.errorMessage === undefined ? null : (
                        <small>{group.errorMessage}</small>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {review.result.recordSyncWarning === undefined ? null : (
                <p role="alert" className="ns-story-analysis-result-warning">
                  资料已写入，但建议状态同步失败（{review.result.recordSyncWarning.code}）：
                  {review.result.recordSyncWarning.message}
                </p>
              )}
              {review.maintenanceMode === "review" &&
              review.result.groups.some((group) => group.status === "applied") ? (
                <div className="ns-story-analysis-auto-guide">
                  <span>经常确认同类安全更新？可以为后续章节开启安全自动更新。</span>
                  <button
                    className="ns-icon-text-button"
                    disabled={busy}
                    onClick={() => review.onMaintenanceModeChange("safe-auto")}
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" size={14} />
                    开启安全自动更新
                  </button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionGroup({
  group,
  selected,
  entryTitles,
  onToggle
}: {
  readonly group: SuggestionGroupModel;
  readonly selected: ReadonlySet<string>;
  readonly entryTitles: ReadonlyMap<string, string>;
  readonly onToggle: (suggestionId: string) => void;
}) {
  const firstSuggestion = group.suggestions[0];
  if (firstSuggestion === undefined) return null;
  const selectable = group.suggestions.every(
    (suggestion) => suggestion.status === "pending" || suggestion.status === "accepted"
  );
  const checked = group.suggestions.every((suggestion) => selected.has(suggestion.suggestionId));
  const targetLabels = [
    ...new Set(
      group.suggestions.map((suggestion) =>
        suggestion.targetAssetId === undefined
          ? (suggestion.proposedTitle ?? suggestion.proposedAssetType ?? "新资料")
          : (entryTitles.get(suggestion.targetAssetId) ?? suggestion.targetAssetId)
      )
    )
  ];
  return (
    <section className="ns-story-analysis-group" data-status={group.suggestions[0]?.status}>
      <div className="ns-story-analysis-group-header">
        <label>
          <input
            checked={checked}
            disabled={!selectable}
            onChange={() => onToggle(firstSuggestion.suggestionId)}
            type="checkbox"
          />
          <span>{targetLabels.join("、")}</span>
        </label>
        <div>
          <span className="ns-story-analysis-status" data-status={group.suggestions[0]?.status}>
            {suggestionStatusLabel(group.suggestions[0]?.status ?? "pending")}
          </span>
          <span>{domainLabel(group.suggestions[0]?.domain ?? "")}</span>
          <span>{group.suggestions.length} 条同组</span>
        </div>
      </div>
      <div className="ns-story-analysis-group-body">
        {group.suggestions.map((suggestion) => (
          <article className="ns-story-analysis-suggestion" key={suggestion.suggestionId}>
            <div className="ns-story-analysis-diffs">
              {suggestion.action === "create" ? (
                <div className="ns-story-analysis-diff">
                  <code>新建 {suggestion.proposedAssetType}</code>
                  <span>{suggestion.proposedTitle ?? "未命名资料"}</span>
                </div>
              ) : (
                suggestion.operations.map((operation) => (
                  <div
                    className="ns-story-analysis-diff"
                    key={`${suggestion.suggestionId}:${operation.path}`}
                  >
                    <code>{fieldLabel(operation.path)}</code>
                    <span className="before">
                      {operation.beforePresent ? formatValue(operation.beforeValue) : "未设置"}
                    </span>
                    <span aria-hidden="true">→</span>
                    <span className="after">
                      {operation.op === "remove" ? "移除" : formatValue(operation.afterValue)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="ns-story-analysis-reason">
              <span>{epistemicLabel(suggestion.epistemicStatus)}</span>
              <span>{Math.round(suggestion.confidence * 100)}%</span>
              <p>{suggestion.reason}</p>
            </div>
            {suggestion.evidence.length === 0 ? null : (
              <div className="ns-story-analysis-evidence">
                {suggestion.evidence.map((evidence) => (
                  <span key={`${evidence.start}:${evidence.end}:${evidence.excerptHash}`}>
                    正文 {evidence.start}–{evidence.end} · {evidence.excerptHash.slice(0, 8)}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function IssueRow({
  issue,
  text,
  onTextChange,
  onResolve,
  onDismiss
}: {
  readonly issue: StoryAnalysisIssueProps;
  readonly text: string;
  readonly onTextChange: (value: string) => void;
  readonly onResolve: (decision: string) => void;
  readonly onDismiss: (reason: string) => void;
}) {
  return (
    <article className="ns-story-analysis-issue" data-status={issue.status}>
      <div className="ns-story-analysis-issue-header">
        <AlertTriangle aria-hidden="true" size={15} />
        <strong>{issueTypeLabel(issue.issueType)}</strong>
        <span>{issueStatusLabel(issue.status)}</span>
      </div>
      <div className="ns-story-analysis-claims">
        {issue.claims.map((claim, index) => (
          <div key={`${issue.issueId}:${index}`}>
            <span>声明 {index + 1}</span>
            <strong>{formatValue(claim.value)}</strong>
            {claim.evidence.map((evidence) => (
              <small key={`${evidence.start}:${evidence.end}:${evidence.excerptHash}`}>
                正文 {evidence.start}–{evidence.end}
              </small>
            ))}
          </div>
        ))}
      </div>
      {issue.status !== "open" ? null : (
        <div className="ns-story-analysis-issue-actions">
          <input
            aria-label="填写解决决定或忽略原因"
            onChange={(event) => onTextChange(event.currentTarget.value)}
            placeholder="决定或原因"
            value={text}
          />
          <button
            className="ns-icon-text-button"
            disabled={text.trim().length === 0}
            onClick={() => onResolve(text)}
            type="button"
          >
            <Check aria-hidden="true" size={14} />
            解决
          </button>
          <button
            className="ns-icon-text-button"
            disabled={text.trim().length === 0}
            onClick={() => onDismiss(text)}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            忽略
          </button>
        </div>
      )}
    </article>
  );
}

interface SuggestionGroupModel {
  readonly consistencyGroupId: string;
  readonly suggestions: readonly StoryAnalysisSuggestionProps[];
}

function groupSuggestions(
  suggestions: readonly StoryAnalysisSuggestionProps[]
): SuggestionGroupModel[] {
  const groups = new Map<string, StoryAnalysisSuggestionProps[]>();
  for (const suggestion of suggestions) {
    groups.set(suggestion.consistencyGroupId, [
      ...(groups.get(suggestion.consistencyGroupId) ?? []),
      suggestion
    ]);
  }
  return [...groups.entries()].map(([consistencyGroupId, entries]) => ({
    consistencyGroupId,
    suggestions: entries
  }));
}

function chapterLabel(chapterId: string, titles: ReadonlyMap<string, string>): string {
  return titles.get(chapterId) ?? chapterId;
}

function formatValue(value: unknown): string {
  if (value === null) return "空";
  if (typeof value === "string") return value.trim().length === 0 ? "空文本" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined) return "未设置";
  const serialized = JSON.stringify(value);
  return serialized.length > 160 ? `${serialized.slice(0, 157)}...` : serialized;
}

function fieldLabel(path: string): string {
  const labels: Readonly<Record<string, string>> = {
    "/summary": "摘要",
    "/relations": "关系",
    "/details/currentState/locationId": "当前位置",
    "/details/currentState/heldItemIds": "持有物品",
    "/details/currentState/emotional": "情绪状态",
    "/details/currentState/physical": "身体状态",
    "/details/currentState/asOfChapterId": "状态章节",
    "/details/holderId": "持有者",
    "/details/currentLocationId": "物品位置",
    "/details/state": "物品状态",
    "/details/asOfChapterId": "状态章节"
  };
  return labels[path] ?? path;
}

function domainLabel(domain: string): string {
  const labels: Readonly<Record<string, string>> = {
    "character.behavior": "人物行为",
    "character.location": "人物位置",
    "character.resource": "人物物品",
    "character.relationship": "人物关系",
    "character.emotion": "人物情绪",
    "character.information": "人物认知",
    "character.physical_state": "人物状态",
    foreshadow: "伏笔",
    timeline: "时间线"
  };
  return labels[domain] ?? domain;
}

function suggestionStatusLabel(status: StoryAnalysisSuggestionProps["status"]): string {
  return {
    pending: "待处理",
    accepted: "已接受",
    applied: "已应用",
    rejected: "已拒绝",
    stale: "已过期",
    failed: "失败"
  }[status];
}

function epistemicLabel(status: string): string {
  return (
    {
      narrator_asserted: "客观叙述",
      dialogue_claim: "对白声明",
      character_belief: "人物认知",
      rumor: "传闻",
      model_inference: "模型推断",
      uncertain: "不确定"
    }[status] ?? status
  );
}

function issueTypeLabel(type: StoryAnalysisIssueProps["issueType"]): string {
  return {
    conflict: "事实冲突",
    ambiguity: "含义不明确",
    unresolved_entity: "实体未识别",
    overdue_foreshadow: "伏笔逾期"
  }[type];
}

function issueStatusLabel(status: StoryAnalysisIssueProps["status"]): string {
  return { open: "待解决", resolved: "已解决", dismissed: "已忽略", stale: "已过期" }[status];
}

function busyLabel(status: StoryAnalysisReviewProps["status"]): string {
  return {
    loading: "正在加载...",
    analyzing: "正在分析章节...",
    transitioning: "正在更新状态...",
    preparing: "正在生成变更预览...",
    applying: "正在事务应用...",
    "saving-settings": "正在保存设置...",
    idle: "",
    ready: "",
    error: ""
  }[status];
}

function applyStatusLabel(status: string): string {
  return status === "applied" ? "已应用" : status === "rolled_back" ? "已回滚" : "需要处理";
}

function shortGroupId(groupId: string): string {
  return groupId.length <= 20 ? groupId : `${groupId.slice(0, 12)}...${groupId.slice(-6)}`;
}
