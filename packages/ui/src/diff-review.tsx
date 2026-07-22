import { ArrowLeft, Check, FileText, X } from "lucide-react";

import {
  canApplyChangeSet,
  changeSetTotals,
  isFinalChangeSetStatus,
  selectedChangeSetFiles,
  type ChangeSetReviewFile,
  type ChangeSetReviewHunk,
  type ChangeSetReviewProps
} from "./change-set-review.js";

export function DiffReview({ review }: { readonly review: ChangeSetReviewProps }) {
  const totals = changeSetTotals(review.changeSet);
  const locked = isFinalChangeSetStatus(review.changeSet.status);

  return (
    <section className="ns-diff-review" aria-label="变更集差异审阅">
      <header className="ns-diff-review-header">
        <div>
          <span
            aria-label={review.changeSet.status === "applied" ? "AI 修改已写入" : undefined}
            className={
              review.changeSet.status === "applied"
                ? "ns-change-set-state ns-ai-applied-stamp"
                : "ns-change-set-state"
            }
            data-status={review.changeSet.status}
          >
            {review.changeSet.status === "applied" ? "已写入" : "尚未写入"}
          </span>
          <strong>{review.changeSet.files.length} 个文件</strong>
          <span className="ns-diff-addition">+{totals.additions}</span>
          <span className="ns-diff-deletion">-{totals.deletions}</span>
        </div>
        <div className="ns-diff-review-actions">
          <button aria-label="返回对话" className="ns-icon-text-button" onClick={review.onReturn} type="button">
            <ArrowLeft aria-hidden="true" size={14} />返回对话
          </button>
          {review.changeSet.status === "applied" ? (
            <button
              aria-label="撤销本次运行"
              className="ns-ai-secondary-button"
              disabled={review.applying || review.canUndoRun !== true}
              onClick={review.onUndoRun}
              type="button"
            >
              <X aria-hidden="true" size={14} />撤销本次运行
            </button>
          ) : (
            <>
              <button aria-label="拒绝全部" className="ns-icon-text-button" disabled={review.applying || review.selectionPending || locked} onClick={review.onReject} type="button">
                <X aria-hidden="true" size={14} />拒绝全部
              </button>
              <button aria-label="应用所选" className="ns-ai-secondary-button" disabled={!canApplyChangeSet(review)} onClick={review.onApply} type="button">
                <Check aria-hidden="true" size={14} />应用所选
              </button>
            </>
          )}
        </div>
      </header>
      <div className="ns-diff-review-binding" aria-label="Change Set 审批绑定">
        <span>v{review.changeSet.revision}</span>
        <code>{review.changeSet.checksum}</code>
      </div>
      <div className="ns-diff-review-layout">
        <aside className="ns-diff-review-files" aria-label="变更文件">
          {review.changeSet.files.map((file) => (
            <FileSelection key={file.relativePath} file={file} review={review} />
          ))}
        </aside>
        <div className="ns-diff-review-content">
          {review.changeSet.files.map((file) => (
            <FileDiff key={file.relativePath} file={file} review={review} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FileSelection({ file, review }: { readonly file: ChangeSetReviewFile; readonly review: ChangeSetReviewProps }) {
  const additions = file.hunks.reduce((total, hunk) => total + hunk.additions, 0);
  const deletions = file.hunks.reduce((total, hunk) => total + hunk.deletions, 0);
  const conflicted = review.baseHashConflictPaths.includes(file.relativePath);
  const dirty = review.dirtyTargetPaths.includes(file.relativePath);

  return (
    <label className="ns-diff-review-file-row" data-selected={file.selected}>
      <input
        aria-label={`包含文件：${file.relativePath}`}
        checked={file.selected}
        disabled={review.applying || review.selectionPending || isFinalChangeSetStatus(review.changeSet.status)}
        key={`${review.changeSet.revision}:${file.relativePath}`}
        onChange={(event) => {
          const selected = event.currentTarget.checked;
          const files = selectedChangeSetFiles(review.changeSet).map((selection) =>
            selection.relativePath === file.relativePath
              ? { ...selection, selected, selectedHunkIds: selected ? file.hunks.map((hunk) => hunk.hunkId) : [] }
              : selection
          );
          review.onSelectionChange({ files });
        }}
        type="checkbox"
      />
      <FileText aria-hidden="true" size={14} />
      <span>{file.relativePath}</span>
      <small>+{additions} -{deletions}</small>
      {conflicted ? <em>Base hash 冲突</em> : dirty ? <em>未保存目标</em> : null}
    </label>
  );
}

function FileDiff({ file, review }: { readonly file: ChangeSetReviewFile; readonly review: ChangeSetReviewProps }) {
  return (
    <section className="ns-diff-file" aria-label={`文件差异：${file.relativePath}`}>
      <header><strong>{file.relativePath}</strong><span>{file.validation.valid ? "校验通过" : "校验失败"}</span></header>
      {file.validation.issues.length === 0 ? null : (
        <ul className="ns-diff-validation" aria-label={`校验问题：${file.relativePath}`}>
          {file.validation.issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {file.hunks.map((hunk) => (
        <article className="ns-diff-hunk" key={hunk.hunkId}>
          <label className="ns-diff-hunk-selector">
            <input
              aria-label={`包含变更块：${hunk.label}`}
              checked={hunk.selected}
              disabled={review.applying || review.selectionPending || !file.selected || isFinalChangeSetStatus(review.changeSet.status)}
              key={`${review.changeSet.revision}:${hunk.hunkId}`}
              onChange={(event) => {
                const selectedHunkIds = file.hunks
                  .filter((candidate) => candidate.hunkId === hunk.hunkId ? event.currentTarget.checked : candidate.selected)
                  .map((candidate) => candidate.hunkId);
                const files = selectedChangeSetFiles(review.changeSet).map((selection) =>
                  selection.relativePath === file.relativePath
                    ? { ...selection, selected: selectedHunkIds.length > 0, selectedHunkIds }
                    : selection
                );
                review.onSelectionChange({ files });
              }}
              type="checkbox"
            />
            <span>{hunk.label}</span><small>+{hunk.additions} -{hunk.deletions}</small>
          </label>
          <HunkDiff assetType={file.assetType} hunk={hunk} />
        </article>
      ))}
    </section>
  );
}

function HunkDiff({
  assetType,
  hunk
}: {
  readonly assetType: string;
  readonly hunk: ChangeSetReviewHunk;
}) {
  if (assetType === "chapter") {
    return <ChapterParagraphDiff hunk={hunk} />;
  }
  return <TextLineDiff hunk={hunk} />;
}

function ChapterParagraphDiff({ hunk }: { readonly hunk: ChangeSetReviewHunk }) {
  const bounded = diffExceedsLcsBudget(
    tokenizeWords(hunk.baseText),
    tokenizeWords(hunk.candidateText)
  );
  return (
    <div
      className="ns-diff-lines"
      data-diff-fallback={bounded ? "bounded" : undefined}
      data-diff-view="paragraph"
    >
      <p className="ns-diff-line" data-diff-block="paragraph" data-kind="deletion">
        <span className="ns-visually-hidden">原段落 {hunk.label}：</span>
        <span aria-hidden="true">-</span>
        {bounded ? (
          <del data-diff-highlight="word">{hunk.baseText}</del>
        ) : (
          <InlineDiffText
            baseText={hunk.baseText}
            candidateText={hunk.candidateText}
            highlight="word"
            side="deletion"
          />
        )}
      </p>
      <p className="ns-diff-line" data-diff-block="paragraph" data-kind="addition">
        <span className="ns-visually-hidden">候选段落 {hunk.label}：</span>
        <span aria-hidden="true">+</span>
        {bounded ? (
          <ins data-diff-highlight="word">{hunk.candidateText}</ins>
        ) : (
          <InlineDiffText
            baseText={hunk.baseText}
            candidateText={hunk.candidateText}
            highlight="word"
            side="addition"
          />
        )}
      </p>
    </div>
  );
}

function TextLineDiff({ hunk }: { readonly hunk: ChangeSetReviewHunk }) {
  const bounded =
    diffExceedsLcsBudget(splitTextLines(hunk.baseText), splitTextLines(hunk.candidateText)) ||
    diffExceedsLcsBudget(tokenizeWords(hunk.baseText), tokenizeWords(hunk.candidateText));
  if (bounded) {
    return <BoundedTextDiff hunk={hunk} />;
  }
  const rows = buildLineDiffRows(hunk.baseText, hunk.candidateText);
  return (
    <div
      aria-label={`文本行差异：${hunk.label}`}
      className="ns-diff-lines"
      data-diff-view="lines"
      role="list"
    >
      {rows.map((row) => (
        <div
          className="ns-diff-line"
          data-diff-line="true"
          data-kind={row.kind}
          key={`${row.kind}:${row.baseLine ?? "-"}:${row.candidateLine ?? "-"}`}
          role="listitem"
        >
          <span className="ns-visually-hidden">{lineDiffLabel(row)}</span>
          <span aria-hidden="true">{lineDiffPrefix(row.kind)}</span>
          {row.kind === "context" ? (
            <span>{row.text}</span>
          ) : (
            <InlineDiffText
              baseText={row.kind === "deletion" ? row.text : row.comparisonText}
              candidateText={row.kind === "addition" ? row.text : row.comparisonText}
              highlight="inline"
              side={row.kind}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function BoundedTextDiff({ hunk }: { readonly hunk: ChangeSetReviewHunk }) {
  return (
    <div
      aria-label={`文本行差异：${hunk.label}`}
      className="ns-diff-lines"
      data-diff-fallback="bounded"
      data-diff-view="lines"
      role="list"
    >
      <div className="ns-diff-line" data-diff-line="true" data-kind="deletion" role="listitem">
        <span className="ns-visually-hidden">删除的原文件内容：</span>
        <span aria-hidden="true">-</span>
        <del data-diff-highlight="inline">{hunk.baseText}</del>
      </div>
      <div className="ns-diff-line" data-diff-line="true" data-kind="addition" role="listitem">
        <span className="ns-visually-hidden">新增的候选文件内容：</span>
        <span aria-hidden="true">+</span>
        <ins data-diff-highlight="inline">{hunk.candidateText}</ins>
      </div>
    </div>
  );
}

type DiffKind = "context" | "deletion" | "addition";

interface SequenceDiffEntry {
  readonly kind: DiffKind;
  readonly value: string;
}

const MAX_LCS_CELLS = 200_000;
const MAX_LCS_TOKENS = 2_048;

interface LineDiffRow {
  readonly kind: DiffKind;
  readonly text: string;
  readonly comparisonText: string;
  readonly baseLine: number | null;
  readonly candidateLine: number | null;
}

function InlineDiffText({
  baseText,
  candidateText,
  highlight,
  side
}: {
  readonly baseText: string;
  readonly candidateText: string;
  readonly highlight: "word" | "inline";
  readonly side: "deletion" | "addition";
}) {
  const segments = inlineSegments(baseText, candidateText, side);
  return (
    <span>
      {segments.map((segment, index) =>
        segment.kind === "context" ? (
          <span key={`${segment.kind}:${index}`}>{segment.text}</span>
        ) : segment.kind === "deletion" ? (
          <del
            aria-label={`删除：${segment.text}`}
            data-diff-highlight={highlight}
            key={`${segment.kind}:${index}`}
          >
            {segment.text}
          </del>
        ) : (
          <ins
            aria-label={`新增：${segment.text}`}
            data-diff-highlight={highlight}
            key={`${segment.kind}:${index}`}
          >
            {segment.text}
          </ins>
        )
      )}
    </span>
  );
}

function buildLineDiffRows(baseText: string, candidateText: string): LineDiffRow[] {
  const operations = sequenceDiff(splitTextLines(baseText), splitTextLines(candidateText));
  const rows: LineDiffRow[] = [];
  let baseLine = 1;
  let candidateLine = 1;
  let operationIndex = 0;

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];
    if (operation?.kind === "context") {
      rows.push({
        kind: "context",
        text: operation.value,
        comparisonText: operation.value,
        baseLine,
        candidateLine
      });
      baseLine += 1;
      candidateLine += 1;
      operationIndex += 1;
      continue;
    }

    const deletions: { readonly text: string; readonly line: number }[] = [];
    const additions: { readonly text: string; readonly line: number }[] = [];
    while (operationIndex < operations.length) {
      const changedOperation = operations[operationIndex];
      if (changedOperation === undefined || changedOperation.kind === "context") break;
      if (changedOperation.kind === "deletion") {
        deletions.push({ text: changedOperation.value, line: baseLine });
        baseLine += 1;
      } else {
        additions.push({ text: changedOperation.value, line: candidateLine });
        candidateLine += 1;
      }
      operationIndex += 1;
    }

    const changedLineCount = Math.max(deletions.length, additions.length);
    for (let index = 0; index < changedLineCount; index += 1) {
      const deletion = deletions[index];
      const addition = additions[index];
      if (deletion !== undefined) {
        rows.push({
          kind: "deletion",
          text: deletion.text,
          comparisonText: addition?.text ?? "",
          baseLine: deletion.line,
          candidateLine: addition?.line ?? null
        });
      }
      if (addition !== undefined) {
        rows.push({
          kind: "addition",
          text: addition.text,
          comparisonText: deletion?.text ?? "",
          baseLine: deletion?.line ?? null,
          candidateLine: addition.line
        });
      }
    }
  }

  return rows;
}

function inlineSegments(
  baseText: string,
  candidateText: string,
  side: "deletion" | "addition"
): { kind: DiffKind; text: string }[] {
  const visibleKind = side;
  const segments: { kind: DiffKind; text: string }[] = [];
  for (const operation of sequenceDiff(tokenizeWords(baseText), tokenizeWords(candidateText))) {
    if (operation.kind !== "context" && operation.kind !== visibleKind) continue;
    const segmentKind = /^\s+$/u.test(operation.value) ? "context" : operation.kind;
    const previous = segments.at(-1);
    if (previous?.kind === segmentKind) {
      previous.text += operation.value;
    } else {
      segments.push({ kind: segmentKind, text: operation.value });
    }
  }
  return segments;
}

function sequenceDiff(base: readonly string[], candidate: readonly string[]): SequenceDiffEntry[] {
  if (diffExceedsLcsBudget(base, candidate)) {
    return [
      ...base.map((value) => ({ kind: "deletion" as const, value })),
      ...candidate.map((value) => ({ kind: "addition" as const, value }))
    ];
  }
  const lengths = Array.from({ length: base.length + 1 }, () =>
    Array<number>(candidate.length + 1).fill(0)
  );
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex -= 1) {
    const row = lengths[baseIndex];
    if (row === undefined) continue;
    for (let candidateIndex = candidate.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      row[candidateIndex] =
        base[baseIndex] === candidate[candidateIndex]
          ? lcsLength(lengths, baseIndex + 1, candidateIndex + 1) + 1
          : Math.max(
              lcsLength(lengths, baseIndex + 1, candidateIndex),
              lcsLength(lengths, baseIndex, candidateIndex + 1)
            );
    }
  }

  const operations: SequenceDiffEntry[] = [];
  let baseIndex = 0;
  let candidateIndex = 0;
  while (baseIndex < base.length || candidateIndex < candidate.length) {
    const baseValue = base[baseIndex];
    const candidateValue = candidate[candidateIndex];
    if (baseValue !== undefined && baseValue === candidateValue) {
      operations.push({ kind: "context", value: baseValue });
      baseIndex += 1;
      candidateIndex += 1;
    } else if (
      candidateValue !== undefined &&
      (baseValue === undefined ||
        lcsLength(lengths, baseIndex, candidateIndex + 1) >=
          lcsLength(lengths, baseIndex + 1, candidateIndex))
    ) {
      operations.push({ kind: "addition", value: candidateValue });
      candidateIndex += 1;
    } else if (baseValue !== undefined) {
      operations.push({ kind: "deletion", value: baseValue });
      baseIndex += 1;
    }
  }
  return operations;
}

function diffExceedsLcsBudget(base: readonly string[], candidate: readonly string[]): boolean {
  return (
    base.length > MAX_LCS_TOKENS ||
    candidate.length > MAX_LCS_TOKENS ||
    (base.length + 1) * (candidate.length + 1) > MAX_LCS_CELLS
  );
}

function lcsLength(lengths: readonly (readonly number[])[], row: number, column: number): number {
  return lengths[row]?.[column] ?? 0;
}

function tokenizeWords(text: string): string[] {
  const Segmenter = (
    Intl as typeof Intl & {
      readonly Segmenter?: new (
        locale?: string | readonly string[],
        options?: { readonly granularity: "word" }
      ) => { segment(input: string): Iterable<{ readonly segment: string }> };
    }
  ).Segmenter;
  if (Segmenter !== undefined) {
    return Array.from(new Segmenter(undefined, { granularity: "word" }).segment(text), (part) =>
      part.segment
    );
  }
  return text.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

function splitTextLines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\r\n|\n|\r/);
}

function lineDiffPrefix(kind: DiffKind): string {
  return kind === "deletion" ? "-" : kind === "addition" ? "+" : " ";
}

function lineDiffLabel(row: LineDiffRow): string {
  if (row.kind === "deletion") return `删除第 ${row.baseLine} 行：`;
  if (row.kind === "addition") return `新增第 ${row.candidateLine} 行：`;
  return `未变更第 ${row.candidateLine} 行：`;
}
