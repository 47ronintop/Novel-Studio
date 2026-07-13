import { describe, expect, test } from "vitest";

import type { AgentRunEvent, AgentRunSnapshot } from "@novel-studio/agent-engine";
import type { NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";
import type { ChapterEditorProps, ModelSettingsPanelProps } from "@novel-studio/ui";

import { createAgentRunBridge } from "../src/renderer/agent-run-bridge.js";

const snapshot: AgentRunSnapshot = {
  schemaVersion: "1.0",
  runId: "run-bridge",
  projectId: "project-01",
  operationMode: "planning",
  contextMode: "writing",
  writePolicy: "write_before_confirmation",
  userRequest: "检查当前章节",
  status: "planning_model",
  runRevision: 1,
  lastSequence: 1,
  startedAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
  providerCapabilitySnapshot: {
    profileId: "profile-01",
    provider: "openai-compatible",
    modelName: "local-model",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 128000,
    requiredContextTokens: 8000
  },
  pendingUserInputId: null,
  contextSnapshotId: "context-run-bridge-1",
  sourcePlanId: null,
  sourcePlanRevision: null
};

const editor: ChapterEditorProps = {
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "chapter-01",
      type: "chapter",
      title: "第一章",
      order: 1,
      status: "draft",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z"
    },
    body: "dirty editor body"
  },
  dirty: true,
  saveStatus: "Unsaved",
  versionHistory: []
};

const settings = {
  defaultProfileId: "profile-01",
  selectedProfileId: "profile-01",
  profiles: [
    {
      id: "profile-01",
      provider: "openai-compatible",
      displayName: "Local",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelName: "local-model",
      apiKeyRef: "secret://local/key",
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 60000
    }
  ],
  draft: {
    id: "profile-01",
    provider: "openai-compatible",
    displayName: "Local",
    baseUrl: "http://127.0.0.1:1234/v1",
    modelName: "local-model",
    apiKeyRefInput: "",
    temperature: "0.2",
    maxTokens: "4096",
    topP: "1",
    reasoningEffortEnabled: false,
    timeoutMs: "60000"
  },
  saveStatus: "idle" as const,
  modelDiscovery: {
    profileId: "profile-01",
    provider: "openai-compatible",
    status: "loaded" as const,
    models: [
      {
        id: "local-model",
        displayName: "local-model",
        provider: "openai-compatible",
        contextWindow: 128000
      }
    ],
    reasoningStrength: { status: "hidden" as const, reason: "not needed" }
  }
} as ModelSettingsPanelProps;

describe("Agent Run renderer bridge", () => {
  test("starts with the dirty editor buffer as an explicit context source", async () => {
    let received: unknown;
    const api = createApi({
      start: async (command) => {
        received = command;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings
    });

    await bridge.send("检查当前章节");

    expect(received).toMatchObject({
      projectId: "project-01",
      operationMode: "planning",
      initialContextSources: [
        {
          refId: "chapter:chapter-01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/chapter-01.md",
          content: "dirty editor body",
          dirty: true
        }
      ]
    });
  });

  test("rejects capability preflight before calling start", async () => {
    let called = false;
    const api = createApi({
      start: async () => {
        called = true;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: { ...settings, modelDiscovery: undefined }
    });

    const props = await bridge.send("检查当前章节");

    expect(called).toBe(false);
    expect(props?.errorMessage).toContain("cannot start an Agent run");
  });

  test("uses the current editor buffer for context refresh without saving", async () => {
    const calls: string[] = [];
    const api = createApi({
      refreshContext: async (command) => {
        calls.push(
          `${command.decision}:${command.sourceRefs?.join(",") ?? ""}:${
            command.currentSources?.[0]?.content ?? ""
          }`
        );
        return ok({ ...snapshot, status: "planning_model", runRevision: 2 });
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings
    });
    await bridge.send("检查当前章节");
    bridge.syncContext({
      projectId: "project-01",
      activeChapterId: "chapter-01",
      chapterEditor: { ...editor, chapter: { ...editor.chapter, body: "new dirty body" } },
      settings
    });

    await bridge.refreshContext("refresh");

    expect(calls).toEqual(["refresh:chapter:chapter-01:new dirty body"]);
  });
});

function createApi(overrides: {
  start?: (command: unknown) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
  refreshContext?: (command: {
    readonly decision: "refresh" | "exclude" | "cancel";
    readonly sourceRefs?: readonly string[];
    readonly currentSources?: readonly { readonly content: string }[];
  }) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
}): NovelStudioApi {
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  return {
    agentRuns: {
      start: (command) => overrides.start?.(command) ?? Promise.resolve(ok(snapshot)),
      stop: async () => ok(snapshot),
      answerUserInput: async () => ok(snapshot),
      resume: async () => ok(snapshot),
      retryStep: async () => ok(snapshot),
      decidePlan: async () => ok(snapshot),
      refreshContext: (command) =>
        overrides.refreshContext?.(command) ?? Promise.resolve(ok(snapshot)),
      read: async () => ok({ snapshot, events: [] }),
      list: async () => ok([]),
      onEvent: (listener) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      }
    }
  } as unknown as NovelStudioApi;
}
