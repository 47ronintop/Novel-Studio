import type {
  ForeshadowDetails,
  ForeshadowSourceRef,
  ForeshadowTrackingStatus
} from "@novel-studio/shared";
import {
  FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
  collectForeshadowContractWarnings,
  normalizeForeshadowEvidence
} from "@novel-studio/shared";

export const STORY_BIBLE_FORESHADOW_STATUS_OPTIONS: ReadonlyArray<{
  readonly value: ForeshadowTrackingStatus;
  readonly label: string;
}> = [
  { value: "planned", label: "待埋" },
  { value: "planted", label: "已埋" },
  { value: "progressing", label: "推进中" },
  { value: "ready-to-payoff", label: "待回收" },
  { value: "paid-off", label: "已回收" },
  { value: "abandoned", label: "已放弃" }
];

export interface StoryBibleForeshadowChapterOrder {
  readonly id: string;
  readonly order: number;
}

export interface StoryBibleForeshadowRecord {
  readonly id?: string;
  readonly title: string;
  readonly status: string;
  readonly details: ForeshadowDetails;
}

export type StoryBibleForeshadowValidationIssue =
  | {
      readonly code: typeof FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING;
      readonly severity: "warning";
    }
  | {
      readonly code: "evidence-missing-chapter";
      readonly severity: "error";
      readonly sourceIndex: number;
    }
  | {
      readonly code: "evidence-missing-excerpt";
      readonly severity: "error";
      readonly sourceIndex: number;
    }
  | {
      readonly code: "duplicate-evidence-in-draft";
      readonly severity: "error";
      readonly sourceIndex: number;
      readonly duplicateSourceIndex: number;
      readonly chapterId: string;
    }
  | {
      readonly code: "duplicate-evidence-in-asset";
      readonly severity: "error";
      readonly sourceIndex: number;
      readonly duplicateAssetId: string;
      readonly duplicateAssetTitle: string;
      readonly chapterId: string;
    };

const OVERDUE_TRACKING_STATUSES = new Set<ForeshadowTrackingStatus>([
  "planted",
  "progressing",
  "ready-to-payoff"
]);

export function storyBibleForeshadowStatusLabel(status: ForeshadowTrackingStatus): string {
  return (
    STORY_BIBLE_FORESHADOW_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
  );
}

export function isStoryBibleForeshadowOverdue(
  details: ForeshadowDetails,
  chapters: readonly StoryBibleForeshadowChapterOrder[],
  currentChapterId: string | undefined
): boolean {
  if (
    currentChapterId === undefined ||
    details.plannedPayoffChapterId === undefined ||
    !OVERDUE_TRACKING_STATUSES.has(details.trackingStatus)
  ) {
    return false;
  }

  const chapterOrder = new Map(chapters.map((chapter) => [chapter.id, chapter.order]));
  const currentOrder = chapterOrder.get(currentChapterId);
  const payoffOrder = chapterOrder.get(details.plannedPayoffChapterId);
  return currentOrder !== undefined && payoffOrder !== undefined && currentOrder > payoffOrder;
}

export function validateStoryBibleForeshadow(
  current: StoryBibleForeshadowRecord,
  existing: readonly StoryBibleForeshadowRecord[]
): readonly StoryBibleForeshadowValidationIssue[] {
  const issues: StoryBibleForeshadowValidationIssue[] = [];
  for (const warning of collectForeshadowContractWarnings(current.details)) {
    issues.push({
      code: warning.code,
      severity: warning.severity
    });
  }

  const sourceRefs = current.details.sourceRefs ?? [];
  for (const [sourceIndex, sourceRef] of sourceRefs.entries()) {
    if (sourceRef.chapterId.trim().length === 0) {
      issues.push({ code: "evidence-missing-chapter", severity: "error", sourceIndex });
    }
    if (normalizeForeshadowEvidence(sourceRef.excerpt).length === 0) {
      issues.push({ code: "evidence-missing-excerpt", severity: "error", sourceIndex });
    }
  }

  if (current.status === "deleted") {
    return issues;
  }

  const otherEvidence = collectOtherEvidence(current.id, existing);
  const currentEvidence = new Map<string, number>();
  for (const [sourceIndex, sourceRef] of sourceRefs.entries()) {
    const key = evidenceKey(sourceRef);
    if (key === undefined) continue;

    const duplicateSourceIndex = currentEvidence.get(key);
    if (duplicateSourceIndex !== undefined) {
      issues.push({
        code: "duplicate-evidence-in-draft",
        severity: "error",
        sourceIndex,
        duplicateSourceIndex,
        chapterId: sourceRef.chapterId.trim()
      });
      continue;
    }
    currentEvidence.set(key, sourceIndex);

    const duplicateAsset = otherEvidence.get(key);
    if (duplicateAsset !== undefined) {
      issues.push({
        code: "duplicate-evidence-in-asset",
        severity: "error",
        sourceIndex,
        duplicateAssetId: duplicateAsset.id,
        duplicateAssetTitle: duplicateAsset.title,
        chapterId: sourceRef.chapterId.trim()
      });
    }
  }

  return issues;
}

export function storyBibleForeshadowValidationMessage(
  issue: StoryBibleForeshadowValidationIssue
): string {
  switch (issue.code) {
    case FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING:
      return "已回收伏笔尚未选择实际回收章节；这不会阻止保存。";
    case "evidence-missing-chapter":
      return `第 ${issue.sourceIndex + 1} 条原文证据缺少章节。`;
    case "evidence-missing-excerpt":
      return `第 ${issue.sourceIndex + 1} 条原文证据缺少原文片段。`;
    case "duplicate-evidence-in-draft":
      return `第 ${issue.sourceIndex + 1} 条原文证据与第 ${issue.duplicateSourceIndex + 1} 条重复（章节 ${issue.chapterId}）。`;
    case "duplicate-evidence-in-asset":
      return `第 ${issue.sourceIndex + 1} 条原文证据已存在于伏笔“${issue.duplicateAssetTitle}”（章节 ${issue.chapterId}）。`;
  }
}

function collectOtherEvidence(
  currentId: string | undefined,
  existing: readonly StoryBibleForeshadowRecord[]
): ReadonlyMap<string, { readonly id: string; readonly title: string }> {
  const evidence = new Map<string, { readonly id: string; readonly title: string }>();
  for (const asset of existing) {
    if (asset.status === "deleted" || (currentId !== undefined && asset.id === currentId)) {
      continue;
    }
    for (const sourceRef of asset.details.sourceRefs ?? []) {
      const key = evidenceKey(sourceRef);
      if (key !== undefined && !evidence.has(key)) {
        evidence.set(key, { id: asset.id ?? asset.title, title: asset.title });
      }
    }
  }
  return evidence;
}

function evidenceKey(sourceRef: ForeshadowSourceRef): string | undefined {
  const chapterId = sourceRef.chapterId.trim();
  const excerpt = normalizeForeshadowEvidence(sourceRef.excerpt);
  return chapterId.length === 0 || excerpt.length === 0
    ? undefined
    : `${chapterId}\u0000${excerpt}`;
}
