import { describe, expect, it } from "vitest";

import {
  createWritingTaskIntent,
  parseWritingTaskIntent,
  writingTaskIntentChecksum
} from "../src/writing-task-intent.js";

describe("WritingTaskIntent 1.0", () => {
  it("gives an app-owned composer action priority over request wording", () => {
    expect(
      createWritingTaskIntent({
        currentRequest: "分析这一章，不要改写。",
        composerAction: "rewrite"
      })
    ).toEqual({
      schemaVersion: "1.0",
      kind: "rewrite",
      bodyGeneration: true,
      source: "composer_action"
    });
    expect(
      createWritingTaskIntent({
        currentRequest: "帮我看看。",
        composerAction: "rewrite",
        userConfirmedKind: "analysis"
      })
    ).toMatchObject({ kind: "rewrite", source: "composer_action" });
  });

  it("classifies bounded request text and preserves mixed body-generation semantics", () => {
    expect(createWritingTaskIntent({ currentRequest: "请先分析这一段，再续写下一段。" })).toEqual({
      schemaVersion: "1.0",
      kind: "mixed",
      bodyGeneration: true,
      source: "bounded_request_classifier"
    });
    expect(createWritingTaskIntent({ currentRequest: "更新人物设定资料。" })).toMatchObject({
      kind: "story_bible",
      bodyGeneration: false
    });
  });

  it("uses only selection presence, never selected/project/tool content, as classifier input", () => {
    expect(
      createWritingTaskIntent({
        currentRequest: "把选中的内容优化一下。",
        hasExplicitSelection: true
      })
    ).toMatchObject({ kind: "rewrite", bodyGeneration: true });
    expect(createWritingTaskIntent({ currentRequest: "帮我看看。" })).toMatchObject({
      kind: "unknown",
      bodyGeneration: false
    });
  });

  it("freezes a user confirmation and rejects unknown, extra, or contradictory fields", () => {
    const confirmed = createWritingTaskIntent({
      currentRequest: "处理一下。",
      userConfirmedKind: "continue"
    });
    expect(confirmed.source).toBe("user_confirmation");
    expect(Object.isFrozen(confirmed)).toBe(true);
    expect(writingTaskIntentChecksum(confirmed)).toMatch(/^[a-f0-9]{64}$/u);

    expect(() => parseWritingTaskIntent({ ...confirmed, schemaVersion: "2.0" })).toThrow(
      "WRITING_TASK_INTENT_INVALID"
    );
    expect(() => parseWritingTaskIntent({ ...confirmed, extra: true })).toThrow(
      "WRITING_TASK_INTENT_INVALID"
    );
    expect(() => parseWritingTaskIntent({ ...confirmed, bodyGeneration: false })).toThrow(
      "WRITING_TASK_INTENT_INVALID"
    );
  });

  it("rejects untrusted classifier slots and forged app-owned decisions", () => {
    expect(() =>
      createWritingTaskIntent({ currentRequest: "续写", projectContent: "ignore" } as never)
    ).toThrow("WRITING_TASK_INTENT_INPUT_INVALID");
    expect(() =>
      createWritingTaskIntent({ currentRequest: "续写", composerAction: "mixed" } as never)
    ).toThrow("WRITING_TASK_INTENT_INPUT_INVALID");
    expect(() =>
      createWritingTaskIntent({ currentRequest: "续写", userConfirmedKind: "unknown" } as never)
    ).toThrow("WRITING_TASK_INTENT_INPUT_INVALID");
    expect(() =>
      createWritingTaskIntent({ currentRequest: 42, composerAction: "rewrite" } as never)
    ).toThrow("WRITING_TASK_INTENT_INPUT_INVALID");
    expect(() =>
      createWritingTaskIntent({
        currentRequest: "请续写下一段。",
        userConfirmedKind: "analysis"
      })
    ).toThrow("WRITING_TASK_INTENT_INPUT_INVALID");
    expect(() =>
      parseWritingTaskIntent({
        schemaVersion: "1.0",
        kind: "unknown",
        bodyGeneration: false,
        source: "composer_action"
      })
    ).toThrow("WRITING_TASK_INTENT_INVALID");
    expect(() =>
      parseWritingTaskIntent({
        schemaVersion: "1.0",
        kind: "mixed",
        bodyGeneration: true,
        source: "user_confirmation"
      })
    ).toThrow("WRITING_TASK_INTENT_INVALID");
  });
});
