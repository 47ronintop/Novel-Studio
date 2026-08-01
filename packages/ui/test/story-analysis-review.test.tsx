import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StoryAnalysisReviewView } from "../src/story-analysis-review.js";
import type { StoryAnalysisReviewProps } from "../src/workspace-shell-types.js";

describe("Story Analysis review view", () => {
  test("renders indivisible groups, issue actions, Change Set preview, and apply results", () => {
    const html = renderToStaticMarkup(
      <StoryAnalysisReviewView chapterOptions={[]} entries={[]} review={reviewProps()} />
    );

    expect(html.match(/<section class="ns-story-analysis-group"/gu)).toHaveLength(1);
    expect(html).toContain("2 条同组");
    expect(html).toContain("旧摘要");
    expect(html).toContain("新摘要");
    expect(html).toContain("客观叙述");
    expect(html).toContain("正文 12–18");
    expect(html).toContain("一致性问题");
    expect(html).toContain("填写解决决定或忽略原因");
    expect(html).toContain("确认并应用");
    expect(html).toContain("验证通过");
    expect(html).toContain("分组结果");
    expect(html).toContain("后台分析");
  });
});

function reviewProps(): StoryAnalysisReviewProps {
  const groupId = `cgrp_${"1".repeat(32)}`;
  const suggestion = (suffix: string) => ({
    suggestionId: `sug_${suffix.repeat(32)}`,
    consistencyGroupId: groupId,
    groupSize: 2,
    status: "accepted" as const,
    revision: 2,
    domain: "character.location",
    action: "patch" as const,
    targetAssetId: `chr_${"2".repeat(32)}`,
    operations: [{
      op: "replace" as const,
      path: "/summary",
      beforePresent: true,
      beforeValue: "旧摘要",
      afterValue: "新摘要"
    }],
    evidence: [{ start: 12, end: 18, excerptHash: "a".repeat(64) }],
    epistemicStatus: "narrator_asserted",
    confidence: 0.97,
    reason: "正文确认了人物状态。"
  });
  return {
    open: true,
    status: "ready",
    completionMode: "background-review",
    pendingCount: 0,
    openIssueCount: 1,
    summaries: [{
      workflowRunId: `wfrun_story_${"3".repeat(32)}`,
      chapterId: "ch_01",
      status: "completed",
      updatedAt: "2026-07-31T00:00:00.000Z",
      pendingSuggestionCount: 0,
      openIssueCount: 1
    }],
    activeWorkflowRunId: `wfrun_story_${"3".repeat(32)}`,
    activeChapterId: "ch_01",
    selectedSuggestionIds: [suggestion("a").suggestionId, suggestion("b").suggestionId],
    filters: { recordType: "all", status: "all", domain: "all" },
    suggestions: [suggestion("a"), suggestion("b")],
    issues: [{
      issueId: `issue_${"4".repeat(32)}`,
      revision: 1,
      issueType: "conflict",
      status: "open",
      claims: [
        { value: "北站", evidence: [{ start: 12, end: 18, excerptHash: "a".repeat(64) }] },
        { value: "南站", evidence: [] }
      ],
      affectedRefs: [`chr_${"2".repeat(32)}`]
    }],
    preview: {
      changeSetId: `change_set_${"5".repeat(32)}`,
      revision: 1,
      checksum: "b".repeat(64),
      files: [{
        relativePath: `characters/chr_${"2".repeat(32)}.json`,
        assetId: `chr_${"2".repeat(32)}`,
        consistencyGroupId: groupId,
        valid: true,
        hunkCount: 2
      }],
      operations: []
    },
    result: {
      applyBatchId: `apply_${"6".repeat(32)}`,
      groups: [{
        consistencyGroupId: groupId,
        status: "applied",
        versionGroupId: `vg_${"7".repeat(32)}`,
        suggestionIds: [suggestion("a").suggestionId, suggestion("b").suggestionId]
      }]
    },
    onOpen: noop,
    onClose: noop,
    onRunSelect: noop,
    onFiltersChange: noop,
    onSuggestionToggle: noop,
    onAcceptSelected: noop,
    onRejectSelected: noop,
    onPrepareSelected: noop,
    onApplyPrepared: noop,
    onRefreshStaleness: noop,
    onResolveIssue: noop,
    onDismissIssue: noop,
    onReanalyze: noop,
    onCompletionModeChange: noop
  };
}

function noop(): void {}
