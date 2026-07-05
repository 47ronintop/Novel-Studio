import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  CreateProjectInput,
  ProjectMetadata,
  ProjectRepositoryPort,
  ProjectSettings,
  ProjectSnapshot
} from "./ports.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";
import { writeTextAtomically } from "./atomic-write.js";

interface PluginRegistryFile extends JsonObject {
  schemaVersion: "1.0";
  plugins: [];
}

export interface ProjectFileRepositoryOptions {
  projectRoot: string;
  traceId?: string;
  now?: () => string;
}

export class ProjectFileRepository implements ProjectRepositoryPort {
  private readonly traceId: string;

  public constructor(private readonly options: ProjectFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_project";
  }

  public async openProject(): Promise<Result<ProjectSnapshot, UnifiedError>> {
    const projectResult = await this.readAndValidate<ProjectMetadata>("project.json", "project");
    if (!projectResult.ok) {
      return projectResult;
    }

    const settingsResult = await this.readAndValidate<ProjectSettings>("settings.json", "settings");
    if (!settingsResult.ok) {
      return settingsResult;
    }

    return ok({
      project: projectResult.value,
      settings: settingsResult.value
    });
  }

  public async createProject(
    input: CreateProjectInput
  ): Promise<Result<ProjectSnapshot, UnifiedError>> {
    const now = this.options.now?.() ?? new Date().toISOString();
    const project: ProjectMetadata = {
      schemaVersion: "1.0",
      projectId: input.projectId,
      title: input.title,
      projectType: input.projectType ?? "novel",
      language: input.language,
      createdAt: now,
      updatedAt: now,
      defaultWorkflowId: "wf_review_chapter",
      defaultModelProfileId: "model_default",
      stats: {
        targetWordCount: input.targetWordCount ?? 100000,
        currentWordCount: 0,
        chapterCount: 0
      }
    };
    const settings: ProjectSettings = {
      schemaVersion: "1.0",
      autosave: {
        enabled: true,
        intervalMs: 30000,
        createHistorySnapshot: false
      },
      history: {
        snapshotPolicy: "manual-and-interval",
        intervalMinutes: 10,
        maxSnapshotsPerChapter: 20
      },
      models: {
        defaultProfileId: "model_default",
        profiles: [
          {
            id: "model_default",
            provider: "openai-compatible",
            displayName: "Default Model",
            baseUrl: "https://api.example.com/v1",
            apiKeyRef: "secret://model_default/api_key",
            modelName: "example-model",
            temperature: 0.7,
            maxTokens: 4096,
            topP: 1,
            timeoutMs: 60000,
            frequencyPenalty: 0,
            presencePenalty: 0
          }
        ]
      }
    };
    const pluginRegistry: PluginRegistryFile = {
      schemaVersion: "1.0",
      plugins: []
    };
    const defaultConfigAssets = createDefaultConfigAssets(now);

    const projectValidation = await validateWithSchema("project", project);
    if (!projectValidation.valid) {
      return err(
        validationError({
          code: "PROJECT_FILE_INVALID",
          message: "Project metadata failed schema validation.",
          suggestedAction: "Fix project creation input and retry.",
          traceId: this.traceId,
          redactedDetail: {
            issues: projectValidation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    const settingsValidation = await validateWithSchema("settings", settings);
    if (!settingsValidation.valid) {
      return err(
        validationError({
          code: "PROJECT_FILE_INVALID",
          message: "Project settings failed schema validation.",
          suggestedAction: "Fix default settings and retry.",
          traceId: this.traceId,
          redactedDetail: {
            issues: settingsValidation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    const pluginRegistryValidation = await validateWithSchema("plugin-registry", pluginRegistry);
    if (!pluginRegistryValidation.valid) {
      return err(
        validationError({
          code: "PROJECT_FILE_INVALID",
          message: "Project plugin registry failed schema validation.",
          suggestedAction: "Fix default plugin registry and retry.",
          traceId: this.traceId,
          redactedDetail: {
            issues: pluginRegistryValidation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }
    for (const asset of defaultConfigAssets) {
      const validation = await validateWithSchema(asset.schemaName, asset.content);
      if (!validation.valid) {
        return err(
          validationError({
            code: "PROJECT_FILE_INVALID",
            message: "Project default config asset failed schema validation.",
            suggestedAction: "Fix default Studio config assets and retry.",
            traceId: this.traceId,
            redactedDetail: {
              assetPath: asset.relativePath,
              issues: validation.issues.map((issue) => ({
                instancePath: issue.instancePath,
                schemaPath: issue.schemaPath,
                keyword: issue.keyword,
                message: issue.message
              }))
            }
          })
        );
      }
    }

    try {
      await mkdir(this.options.projectRoot, { recursive: true });
      await Promise.all(
        [
          "chapters",
          "characters",
          "world",
          "outline",
          "timeline",
          "memories",
          "prompts",
          "agents",
          "workflow",
          "workflows",
          "plugins",
          "history",
          join("history", "chapters"),
          join("history", "recovery"),
          "cache"
        ].map((directory) => mkdir(join(this.options.projectRoot, directory), { recursive: true }))
      );
    } catch (error) {
      return err(
        storageError({
          code: "PROJECT_CREATE_FAILED",
          message: "Project folders could not be created.",
          suggestedAction: "Choose a writable project folder and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    const projectWrite = await writeJsonFile(
      join(this.options.projectRoot, "project.json"),
      project,
      this.traceId
    );
    if (!projectWrite.ok) {
      return projectWrite;
    }

    const settingsWrite = await writeJsonFile(
      join(this.options.projectRoot, "settings.json"),
      settings,
      this.traceId
    );
    if (!settingsWrite.ok) {
      return settingsWrite;
    }

    const pluginRegistryWrite = await writeJsonFile(
      join(this.options.projectRoot, "plugins", "plugins.json"),
      pluginRegistry,
      this.traceId
    );
    if (!pluginRegistryWrite.ok) {
      return pluginRegistryWrite;
    }

    for (const asset of defaultConfigAssets) {
      const write = await writeJsonFile(
        join(this.options.projectRoot, asset.relativePath),
        asset.content,
        this.traceId
      );
      if (!write.ok) {
        return write;
      }
    }

    return ok({ project, settings });
  }

  private async readAndValidate<T>(
    fileName: string,
    schemaName: string
  ): Promise<Result<T, UnifiedError>> {
    const filePath = join(this.options.projectRoot, fileName);
    let parsed: unknown;

    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      return err(
        storageError({
          code: "PROJECT_FILE_MISSING",
          message: `${fileName} could not be read.`,
          suggestedAction: `Restore ${fileName} or choose a valid Novel Studio project folder.`,
          traceId: this.traceId,
          redactedDetail: {
            fileName,
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }

    const validation = await validateWithSchema(schemaName, parsed);
    if (!validation.valid) {
      return err(
        validationError({
          code: "PROJECT_FILE_INVALID",
          message: `${fileName} failed schema validation.`,
          suggestedAction: `Fix ${fileName} and retry opening the project.`,
          traceId: this.traceId,
          redactedDetail: {
            fileName,
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    return ok(parsed as T);
  }
}

async function writeJsonFile(
  targetPath: string,
  content: JsonObject,
  traceId: string
): Promise<Result<void, UnifiedError>> {
  return writeTextAtomically({
    targetPath,
    content: `${JSON.stringify(content, null, 2)}\n`,
    traceId
  });
}

function createDefaultConfigAssets(now: string): readonly {
  readonly schemaName: "prompt-template" | "agent-config" | "workflow-definition";
  readonly relativePath: string;
  readonly content: JsonObject;
}[] {
  return [
    {
      schemaName: "prompt-template",
      relativePath: join("prompts", "prompt_reviewer_default.json"),
      content: {
        schemaVersion: "1.0",
        id: "prompt_reviewer_default",
        type: "prompt.template",
        title: "默认审稿 Prompt",
        status: "active",
        promptRole: "reviewer",
        template: "请根据 {{context.goal}} 和上下文审阅当前章节，输出结构化修改建议。",
        variables: [
          {
            name: "context.goal",
            required: true,
            type: "string"
          }
        ],
        createdAt: now,
        updatedAt: now
      }
    },
    {
      schemaName: "agent-config",
      relativePath: join("agents", "agent_reviewer_default.json"),
      content: {
        schemaVersion: "1.0",
        id: "agent_reviewer_default",
        type: "agent.config",
        title: "默认审稿 Agent",
        status: "active",
        agentRole: "reviewer",
        promptTemplateId: "prompt_reviewer_default",
        inputSchemaId: "schema.agent.reviewer.input.v1",
        outputSchemaId: "schema.agent.reviewer.output.v1",
        modelProfileId: "model_default",
        tools: [],
        limits: {
          maxRetries: 2,
          timeoutMs: 90000
        },
        createdAt: now,
        updatedAt: now
      }
    },
    {
      schemaName: "workflow-definition",
      relativePath: join("workflow", "wf_review_chapter.json"),
      content: {
        schemaVersion: "1.0",
        id: "wf_review_chapter",
        type: "workflow.definition",
        title: "审稿当前章节",
        status: "active",
        entryStepId: "step_build_context",
        steps: [
          {
            id: "step_build_context",
            kind: "context",
            nextStepId: "step_review"
          },
          {
            id: "step_review",
            kind: "agent",
            agentId: "agent_reviewer_default"
          }
        ],
        createdAt: now,
        updatedAt: now
      }
    }
  ];
}
