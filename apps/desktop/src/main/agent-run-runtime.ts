import {
  createAgentRunSession,
  type AgentModelRoundInput,
  type AgentModelStreamEvent,
  type AgentReadToolExecutor,
  type AgentRunModelDriver,
  type AgentRunSession
} from "@novel-studio/application";
import type { LlmModelProfile, LlmParameters } from "@novel-studio/llm-adapter";
import type { AgentToolName } from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type JsonObject } from "@novel-studio/shared";
import {
  AgentProjectReadRepository,
  AgentRunFileRepository,
  StoryBibleFileRepository
} from "@novel-studio/repository";

export interface DesktopAgentRunSessionOptions {
  readonly projectRoot: string;
  readonly projectId: string;
  readonly activeChapterId: string;
  readonly createRunId?: () => string;
  readonly now?: () => string;
  readonly modelDriver?: AgentRunModelDriver;
  readonly resolveModelProfile?: (
    profileId: string
  ) => Promise<{ readonly modelProfile: LlmModelProfile; readonly parameters?: LlmParameters } | undefined>;
  readonly createAgentModelDriver?: (input: {
    readonly modelProfile: LlmModelProfile;
    readonly parameters?: LlmParameters;
  }) => AgentRunModelDriver;
  readonly readEditorBuffer?: (refId: string) => Promise<string | undefined>;
}

export function createDesktopAgentRunSession(
  options: DesktopAgentRunSessionOptions
): AgentRunSession {
  const projectReads = new AgentProjectReadRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-project-read"
  });
  const storyBible = new StoryBibleFileRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-story-bible"
  });
  const repository = new AgentRunFileRepository({
    projectRoot: options.projectRoot,
    traceId: "desktop-agent-run-store"
  });
  const readToolExecutor = createDesktopReadToolExecutor(projectReads, storyBible);

  const scriptedDriver = createDesktopScriptedAgentDriver(options.activeChapterId);
  const modelDriver =
    options.modelDriver ??
    (options.resolveModelProfile === undefined || options.createAgentModelDriver === undefined
      ? scriptedDriver
      : createDesktopAdaptiveAgentDriver({
          scriptedDriver,
          resolveModelProfile: options.resolveModelProfile,
          createAgentModelDriver: options.createAgentModelDriver
        }));

  return createAgentRunSession({
    repository,
    modelDriver,
    readToolExecutor,
    contextSourceReader: {
      async readCurrentSources(input) {
        const current: { refId: string; content: string }[] = [];
        for (const source of input.sources) {
          if (source.sourceKind === "editor_buffer") {
            const editorContent = await options.readEditorBuffer?.(source.refId);
            current.push({
              refId: source.refId,
              content: editorContent ?? source.content
            });
            continue;
          }
          if (source.relativePath !== undefined) {
            const read = await projectReads.readText(source.relativePath);
            if (!read.ok) return read;
            current.push({ refId: source.refId, content: read.value.content });
            continue;
          }
          if (source.assetId !== undefined) {
            const asset = await findStoryBibleAsset(storyBible, source.assetId);
            if (!asset.ok) return asset;
            current.push({ refId: source.refId, content: JSON.stringify(asset.value) });
          }
        }
        return ok(current);
      }
    },
    createContextSnapshotId: (runId) => `context_${runId}_1`,
    coordinatorOptions: {
      ...(options.createRunId === undefined ? {} : { createRunId: options.createRunId }),
      ...(options.now === undefined ? {} : { now: options.now })
    }
  });
}

function createDesktopAdaptiveAgentDriver(input: {
  readonly scriptedDriver: AgentRunModelDriver;
  readonly resolveModelProfile: NonNullable<DesktopAgentRunSessionOptions["resolveModelProfile"]>;
  readonly createAgentModelDriver: NonNullable<
    DesktopAgentRunSessionOptions["createAgentModelDriver"]
  >;
}): AgentRunModelDriver {
  return {
    async *streamRound(roundInput) {
      if (roundInput.snapshot.providerCapabilitySnapshot.provider === "demo") {
        yield* input.scriptedDriver.streamRound(roundInput);
        return;
      }
      const profile = await input.resolveModelProfile(
        roundInput.snapshot.providerCapabilitySnapshot.profileId
      );
      if (profile === undefined) {
        throw new Error("The selected Agent model profile is unavailable.");
      }
      const driver = input.createAgentModelDriver(profile);
      yield* driver.streamRound(roundInput);
    }
  };
}

function createDesktopReadToolExecutor(
  projectReads: AgentProjectReadRepository,
  storyBible: StoryBibleFileRepository
): AgentReadToolExecutor {
  return {
    async execute(input) {
      if (input.name === "list_project_entries") {
        const relativeDirectory = readOptionalString(input.arguments, "path") ?? "";
        const listed = await projectReads.listEntries(relativeDirectory);
        return listed.ok
          ? ok({
              summary: `已列出 ${relativeDirectory || "项目根目录"} 的 ${listed.value.length} 个条目`,
              data: asJsonObject({ entries: listed.value })
            })
          : listed;
      }
      if (input.name === "read_chapter") {
        const chapterId = readRequiredId(input.arguments, "chapterId");
        if (chapterId === undefined) return invalidToolArguments(input.name);
        const relativePath = `chapters/${chapterId}.md`;
        const read = await projectReads.readText(relativePath);
        return read.ok
          ? ok({
              summary: `已读取章节 ${chapterId}`,
              data: { content: read.value.content, checksum: read.value.checksum },
              source: {
                refId: `chapter:${chapterId}`,
                sourceKind: "disk_file",
                relativePath,
                content: read.value.content,
                dirty: false
              }
            })
          : read;
      }
      if (input.name === "read_project_text") {
        const relativePath = readOptionalString(input.arguments, "path");
        if (relativePath === undefined) return invalidToolArguments(input.name);
        const read = await projectReads.readText(relativePath);
        return read.ok
          ? ok({
              summary: `已读取 ${relativePath}`,
              data: { content: read.value.content, checksum: read.value.checksum },
              source: {
                refId: `file:${relativePath}`,
                sourceKind: "disk_file",
                relativePath,
                content: read.value.content,
                dirty: false
              }
            })
          : read;
      }
      if (input.name === "read_story_bible") {
        const assetId = readRequiredId(input.arguments, "assetId");
        if (assetId === undefined) return invalidToolArguments(input.name);
        const asset = await findStoryBibleAsset(storyBible, assetId);
        if (!asset.ok) return asset;
        const content = JSON.stringify(asset.value);
        return ok({
          summary: `已读取 Story Bible 资产 ${assetId}`,
          data: { asset: asset.value },
          source: {
            refId: `story-bible:${assetId}`,
            sourceKind: "story_bible_asset",
            assetId,
            content,
            dirty: false
          }
        });
      }
      return invalidToolArguments(input.name);
    }
  };
}

function createDesktopScriptedAgentDriver(activeChapterId: string): AgentRunModelDriver {
  return {
    async *streamRound(input: AgentModelRoundInput): AsyncIterable<AgentModelStreamEvent> {
      const toolResultCount = input.messages.filter((message) => message.role === "tool").length;
      if (toolResultCount === 0) {
        yield { type: "assistant_text_delta", delta: "我会先读取项目结构和当前章节。" };
        yield toolCall("desktop_list_entries", "list_project_entries", { path: "chapters" });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (toolResultCount === 1 && input.snapshot.contextMode === "writing") {
        yield toolCall("desktop_read_chapter", "read_chapter", { chapterId: activeChapterId });
        yield { type: "round_completed", finishReason: "tool_calls" };
        return;
      }
      if (input.snapshot.operationMode === "planning") {
        yield toolCall("desktop_finish_plan", "finish_plan", {
          planId: `plan_${input.runId}`,
          goal: input.snapshot.userRequest,
          successCriteria: ["完成只读上下文核对"],
          nonGoals: ["本次规划不修改任何项目文件"],
          facts: ["已读取项目结构和当前章节"],
          assumptions: [],
          openQuestions: [],
          targetRefs: [{ refId: `chapter:${activeChapterId}`, intent: "按用户目标规划修订" }],
          steps: [
            {
              stepId: "step_review_chapter",
              title: "复核当前章节",
              verification: "重新读取并核对目标与上下文"
            }
          ],
          risks: ["执行前上下文可能变化"],
          verification: ["执行前刷新 Context Snapshot"],
          sourceRefs: [`chapter:${activeChapterId}`]
        });
      } else {
        yield toolCall("desktop_finish", "finish", { summary: "只读 Agent run 已完成。" });
      }
      yield { type: "round_completed", finishReason: "tool_calls" };
    }
  };
}

function toolCall(toolCallId: string, name: AgentToolName, argumentsValue: JsonObject) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(argumentsValue)
  };
}

async function findStoryBibleAsset(repository: StoryBibleFileRepository, assetId: string) {
  const snapshot = await repository.readStoryBible();
  if (!snapshot.ok) return snapshot;
  const assets = [
    ...snapshot.value.characters,
    ...snapshot.value.worldAssets,
    ...(snapshot.value.outline === undefined ? [] : [snapshot.value.outline]),
    ...(snapshot.value.timeline === undefined ? [] : [snapshot.value.timeline]),
    ...snapshot.value.memories
  ];
  const asset = assets.find((candidate) => candidate.id === assetId);
  return asset === undefined
    ? err(
        createUnifiedError({
          code: "AGENT_STORY_BIBLE_ASSET_NOT_FOUND",
          category: "ValidationError",
          message: "The Story Bible asset does not exist.",
          recoverability: "user-action",
          suggestedAction: "Choose an existing Story Bible asset ID.",
          traceId: "desktop-agent-run-runtime"
        })
      )
    : ok(asset);
}

function invalidToolArguments(name: AgentToolName) {
  return err(
    createUnifiedError({
      code: "AGENT_TOOL_ARGUMENTS_INVALID",
      category: "ValidationError",
      message: `Arguments for ${name} are invalid.`,
      recoverability: "user-action",
      suggestedAction: "Use the documented project-relative arguments.",
      traceId: "desktop-agent-run-runtime"
    })
  );
}

function readOptionalString(value: JsonObject, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function readRequiredId(value: JsonObject, key: string): string | undefined {
  const candidate = readOptionalString(value, key);
  return candidate !== undefined && /^[A-Za-z0-9_-]+$/.test(candidate) ? candidate : undefined;
}

function asJsonObject(value: object): JsonObject {
  return value as unknown as JsonObject;
}
