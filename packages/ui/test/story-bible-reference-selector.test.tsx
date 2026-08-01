// @vitest-environment jsdom
import { act, useState } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";

import {
  StoryBibleReferenceSelector,
  type StoryBibleReferenceOption
} from "../src/story-bible-reference-selector.js";
import { StoryBibleRelationsField } from "../src/story-bible-relations-field.js";
import type { StoryBibleEditorProps } from "../src/workspace-shell-types.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("Story Bible searchable reference selector", () => {
  test("supports searchable multi-select and distinguishes deleted, unknown, and missing targets", () => {
    const opened: string[] = [];
    const options: StoryBibleReferenceOption[] = [
      referenceOption("chr_active", "林舟", "character", "ready"),
      referenceOption("chr_deleted", "旧证人", "character", "deleted", false),
      referenceOption("rule_wrong_type", "禁术规则", "world.rule", "unknown", false)
    ];
    mount(<ReferenceHarness onOpen={(entryId) => opened.push(entryId)} options={options} />);

    expect(
      host?.querySelector('[data-reference-id="chr_deleted"]')?.getAttribute("data-reference-state")
    ).toBe("deleted");
    expect(
      host
        ?.querySelector('[data-reference-id="rule_wrong_type"]')
        ?.getAttribute("data-reference-state")
    ).toBe("unknown");
    expect(
      host?.querySelector('[data-reference-id="chr_missing"]')?.getAttribute("data-reference-state")
    ).toBe("missing");
    expect(host?.textContent).toContain("已删除");
    expect(host?.textContent).toContain("目标类型不匹配");
    expect(host?.textContent).toContain("目标缺失");

    const search = host?.querySelector<HTMLInputElement>('[aria-label="关联资料搜索"]');
    act(() => {
      if (search === null || search === undefined) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search,
        "林舟"
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host?.querySelector('[data-reference-option="chr_active"]')).not.toBeNull();
    expect(host?.querySelector('[data-reference-option="chr_deleted"]')).toBeNull();

    act(() => host?.querySelector<HTMLInputElement>('[aria-label="关联资料选项：林舟"]')?.click());
    expect(host?.querySelector('[data-reference-id="chr_active"]')).not.toBeNull();

    act(() =>
      host?.querySelector<HTMLButtonElement>('[aria-label="打开目标资料：旧证人"]')?.click()
    );
    expect(opened).toEqual(["chr_deleted"]);
  });

  test("replaces a single selected target without requiring an ID to be typed", () => {
    const options = [
      referenceOption("loc_old", "旧城区", "world.location", "deleted", false),
      referenceOption("loc_new", "新港", "world.location", "ready")
    ];
    mount(<SingleReferenceHarness options={options} />);

    expect(host?.querySelector('[data-reference-id="loc_old"]')?.textContent).toContain("已删除");
    act(() => host?.querySelector<HTMLInputElement>('[aria-label="当前位置选项：新港"]')?.click());
    expect(host?.querySelector('[data-reference-id="loc_old"]')).toBeNull();
    expect(host?.querySelector('[data-reference-id="loc_new"]')?.textContent).toContain("新港");
  });

  test("projects an incoming symmetric relation as read-only without publishing it", () => {
    const opened: string[] = [];
    const published: unknown[] = [];
    const editor = editorProps({
      entries: [
        storyEntry("chr_owner", "关系规范端", {
          relations: [
            {
              relationId: "rel_symmetric_01",
              sourceId: "chr_owner",
              targetId: "chr_target",
              relationType: "character.relationship",
              direction: "symmetric",
              status: "active",
              validFromChapterId: "ch_01",
              validToChapterId: "ch_02",
              inversePolicy: "derived",
              inverseRelationId: null,
              evidence: [],
              note: "共同守护档案"
            }
          ]
        }),
        storyEntry("chr_target", "当前人物")
      ],
      chapterOptions: [
        { id: "ch_01", title: "雨夜入城", order: 1, status: "draft" },
        { id: "ch_02", title: "档案失窃", order: 2, status: "draft" }
      ],
      draft: {
        id: "chr_target",
        kind: "character",
        assetType: "character",
        title: "当前人物",
        status: "active",
        summary: "",
        aliases: [],
        relations: [],
        relatedEntityIds: [],
        details: {}
      },
      onDraftChange: (_kind, patch) => published.push(patch),
      onEntrySelect: (entryId) => opened.push(entryId)
    });

    const html = renderToStaticMarkup(<StoryBibleRelationsField editor={editor} />);
    expect(html).toContain('data-relation-projection="derived"');
    expect(html).toContain('data-relation-id="rel_symmetric_01"');
    expect(html).toContain("关系规范端");
    expect(html).toContain("人物关系");
    expect(html).toContain("双向");
    expect(html).toContain("1. 雨夜入城 → 2. 档案失窃");
    expect(html).toContain("对称派生 · 只读");
    expect(published).toEqual([]);

    mount(<StoryBibleRelationsField editor={editor} />);
    act(() =>
      host?.querySelector<HTMLButtonElement>('[aria-label="打开目标资料：关系规范端"]')?.click()
    );
    expect(opened).toEqual(["chr_owner"]);
    expect(published).toEqual([]);
  });

  test("offers explicit inverse editing but disables target opening while the draft is dirty", () => {
    const opened: string[] = [];
    const published: unknown[] = [];
    const relation = {
      relationId: `rel_${"1".repeat(32)}`,
      sourceId: "chr_source",
      targetId: "chr_target",
      relationType: "character.relationship",
      direction: "directed" as const,
      status: "active" as const,
      validFromChapterId: null,
      validToChapterId: null,
      inversePolicy: "none" as const,
      inverseRelationId: null,
      evidence: [],
      note: ""
    };
    const editor = editorProps({
      dirty: true,
      entries: [storyEntry("chr_source", "当前人物"), storyEntry("chr_target", "目标人物")],
      draft: {
        id: "chr_source",
        kind: "character",
        assetType: "character",
        title: "当前人物",
        status: "active",
        summary: "",
        aliases: [],
        relations: [relation],
        relatedEntityIds: ["chr_target"],
        details: {}
      },
      onDraftChange: (_kind, patch) => published.push(patch),
      onEntrySelect: (entryId) => opened.push(entryId)
    });
    mount(<StoryBibleRelationsField editor={editor} />);

    expect(host?.textContent).toContain("请先保存或放弃当前草稿，再打开关系目标资料");
    expect(host?.querySelector('[aria-label="打开目标资料：目标人物"]')).toBeNull();
    const policy = host?.querySelector<HTMLSelectElement>('[aria-label="反向关系策略 1"]');
    act(() => {
      if (policy === null || policy === undefined) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        policy,
        "explicit"
      );
      policy.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(published.at(-1)).toMatchObject({
      relations: [{ inversePolicy: "explicit", inverseRelationId: null }]
    });
    expect(opened).toEqual([]);
  });
});

function ReferenceHarness({
  onOpen,
  options
}: {
  readonly onOpen: (entryId: string) => void;
  readonly options: readonly StoryBibleReferenceOption[];
}) {
  const [value, setValue] = useState(["chr_deleted", "rule_wrong_type", "chr_missing"]);
  return (
    <StoryBibleReferenceSelector
      ariaLabel="关联资料"
      label="关联资料"
      mode="multiple"
      onChange={setValue}
      onOpenEntry={onOpen}
      options={options}
      value={value}
    />
  );
}

function SingleReferenceHarness({
  options
}: {
  readonly options: readonly StoryBibleReferenceOption[];
}) {
  const [value, setValue] = useState<string | null>("loc_old");
  return (
    <StoryBibleReferenceSelector
      ariaLabel="当前位置"
      label="当前位置"
      mode="single"
      onChange={setValue}
      options={options}
      value={value}
    />
  );
}

function referenceOption(
  id: string,
  title: string,
  type: string,
  state: StoryBibleReferenceOption["state"],
  selectable = true
): StoryBibleReferenceOption {
  return {
    id,
    title,
    type,
    status: state === "deleted" ? "deleted" : "active",
    state,
    selectable,
    openEntryId: id
  };
}

function storyEntry(
  id: string,
  title: string,
  overrides: Partial<StoryBibleEditorProps["entries"][number]> = {}
): StoryBibleEditorProps["entries"][number] {
  return {
    id,
    kind: "character",
    assetType: "character",
    title,
    status: "active",
    summary: "",
    aliases: [],
    relatedEntityIds: [],
    details: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  } as StoryBibleEditorProps["entries"][number];
}

function editorProps(overrides: Partial<StoryBibleEditorProps>): StoryBibleEditorProps {
  return {
    activeKind: "character",
    viewMode: "detail",
    status: "idle",
    dirty: false,
    entries: [],
    chapterOptions: [],
    foreshadowAnalysis: { status: "closed", selectedChapterIds: [] },
    filters: {
      query: "",
      status: "available",
      worldAssetType: "all",
      foreshadowTrackingStatus: "all"
    },
    externalUpdate: { status: "none" },
    draft: {
      kind: "character",
      assetType: "character",
      title: "",
      status: "active",
      summary: "",
      aliases: [],
      relatedEntityIds: [],
      details: {}
    },
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onFiltersChange: () => undefined,
    onNewDraft: () => undefined,
    onCancelDraft: () => undefined,
    onSave: () => undefined,
    onExternalUpdateReload: () => undefined,
    onExternalUpdateContinue: () => undefined,
    onForeshadowAnalysisOpen: () => undefined,
    onForeshadowAnalysisChapterToggle: () => undefined,
    onForeshadowAnalysisStart: () => undefined,
    onForeshadowAnalysisCandidateToggle: () => undefined,
    onForeshadowAnalysisPreview: () => undefined,
    onForeshadowAnalysisBack: () => undefined,
    onForeshadowAnalysisConfirm: () => undefined,
    onForeshadowAnalysisRetryFailed: () => undefined,
    onForeshadowAnalysisClose: () => undefined,
    ...overrides
  };
}

function mount(node: ReactNode): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
}
