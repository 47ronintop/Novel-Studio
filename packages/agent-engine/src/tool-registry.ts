import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";
import type { JsonObject } from "@novel-studio/shared";
import type { AgentToolCapabilitySnapshot } from "./agent-tool-capabilities.js";

/** The 9 static tool names that exist in Stage 5 baseline (v1.0). */
export type CoreAgentToolName =
  | "list_project_entries"
  | "read_chapter"
  | "read_story_bible"
  | "read_project_text"
  | "propose_chapter_write"
  | "propose_file_write"
  | "finish"
  | "finish_plan"
  | "request_user_input";

/**
 * Phase A new static tools (added when searchEnabled flag is on).
 * @since v1.1
 */
export type SearchAgentToolName = "search_project_text" | "find_project_references";

/**
 * Phase B new static tools (added when fileLifecycleEnabled flag is on).
 * @since v1.1
 */
export type FileLifecycleAgentToolName =
  | "propose_chapter_create"
  | "propose_story_bible_write"
  | "propose_file_create"
  | "propose_file_move"
  | "propose_file_delete"
  | "propose_directory_create";

/**
 * Phase C static tools (added when controlledExecutionEnabled / gitReadEnabled).
 * @since v1.1
 */
export type ControlledExecutionAgentToolName = "run_project_task" | "git_status" | "git_diff";

/**
 * Phase D static tools.
 * @since v1.1
 */
export type NetworkAgentToolName = "web_search" | "fetch_url";

/**
 * Namespaced dynamic tool IDs for plugins and MCP servers.
 * @since v1.1
 */
export type NamespacedExternalToolId = `plugin:${string}` | `mcp:${string}`;

/**
 * All static tool names across all phases.
 * @since v1.1
 */
export type StaticAgentToolName =
  | CoreAgentToolName
  | SearchAgentToolName
  | FileLifecycleAgentToolName
  | ControlledExecutionAgentToolName
  | NetworkAgentToolName;

/** Backward-compatible alias — keeps existing callers that reference AgentToolName working. */
export type AgentToolName = CoreAgentToolName;

export type AgentToolKind =
  | "file_tool"
  | "search_tool"
  | "command_tool"
  | "vcs_tool"
  | "network_tool"
  | "external_tool"
  | "protocol_action";

export type AgentToolEffect =
  | "read"
  | "propose"
  | "execute"
  | "external_read"
  | "external_action"
  | "control";

export type AgentToolDataEgress = "none" | "provider_query" | "remote_tool_arguments";
export type AgentToolRetrySemantics = "safe" | "idempotency_key_required" | "never_automatic";

export interface AgentToolDescriptor {
  /**
   * Canonical internal tool ID. For core tools equals `name`; for dynamic tools is the
   * full namespaced ID, e.g. "plugin:acme/summarise". Optional for test stubs.
   */
  readonly id?: StaticAgentToolName | NamespacedExternalToolId;
  /**
   * Backward-compatible primary identifier. All callers using `tool.name` continue to work.
   * For core tools name === id; for dynamic tools name === providerName.
   */
  readonly name: string;
  /** Name sent to the model provider. Optional for test stubs; defaults to `name`. */
  readonly providerName?: string;
  /** Human-readable label. Optional for test stubs. */
  readonly displayName?: string;
  /** Description sent to the model. Optional for test stubs. */
  readonly description?: string;
  readonly kind: AgentToolKind;
  readonly effect: AgentToolEffect;
  /** Optional for test stubs; defaults to "none". */
  readonly dataEgress?: AgentToolDataEgress;
  /** Optional for test stubs; defaults to false. */
  readonly destructive?: boolean;
  /** Optional for test stubs; defaults to "safe". */
  readonly retrySemantics?: AgentToolRetrySemantics;
  /** Optional for test stubs. */
  readonly source?: { readonly kind: "core" | "plugin" | "mcp"; readonly id: string };
  readonly inputSchema: JsonObject;
  /** Optional for test stubs; empty string when absent. */
  readonly descriptorDigest?: string;
}

export type AgentToolArgumentsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const MAX_AGENT_TOOL_ARGUMENT_BYTES = 1_048_576;

export interface ListAgentToolsInput {
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  /**
   * Task 0.1: Optional capability snapshot. When absent the registry falls back to v1.0
   * behaviour — exactly the original 9 tools, preserving all pre-Phase-0 test contracts.
   */
  readonly capabilitySnapshot?: AgentToolCapabilitySnapshot;
}

export function listAgentTools(input: ListAgentToolsInput): readonly AgentToolDescriptor[] {
  const readTools: AgentToolDescriptor[] =
    input.contextMode === "writing"
      ? [
          coreTool("list_project_entries", "file_tool", "read"),
          coreTool("read_chapter", "file_tool", "read"),
          coreTool("read_story_bible", "file_tool", "read"),
          coreTool("read_project_text", "file_tool", "read")
        ]
      : [
          coreTool("list_project_entries", "file_tool", "read"),
          coreTool("read_project_text", "file_tool", "read")
        ];

  const cap = input.capabilitySnapshot;

  // Phase A: search tools (planning + execution, writing + general_file)
  const searchTools: AgentToolDescriptor[] =
    cap?.searchEnabled === true
      ? [
          coreTool("search_project_text", "search_tool", "read"),
          coreTool("find_project_references", "search_tool", "read")
        ]
      : [];

  if (input.operationMode === "planning") {
    return [
      ...readTools,
      ...searchTools,
      coreTool("finish_plan", "protocol_action", "control"),
      coreTool("request_user_input", "protocol_action", "control")
    ];
  }

  // Phase B: file lifecycle tools (execution only)
  const fileLifecycleTools: AgentToolDescriptor[] =
    cap?.fileLifecycleEnabled === true
      ? input.contextMode === "writing"
        ? [
            coreTool("propose_chapter_create", "file_tool", "propose"),
            coreTool("propose_story_bible_write", "file_tool", "propose")
          ]
        : [
            coreTool("propose_file_create", "file_tool", "propose"),
            coreTool("propose_file_move", "file_tool", "propose"),
            coreTool("propose_file_delete", "file_tool", "propose"),
            coreTool("propose_directory_create", "file_tool", "propose")
          ]
      : [];

  // Phase C: controlled execution tools (execution + general_file only)
  const executionTools: AgentToolDescriptor[] =
    cap?.controlledExecutionEnabled === true && input.contextMode === "general_file"
      ? [coreTool("run_project_task", "command_tool", "execute")]
      : [];

  // Phase C Git: read tools (execution + both context modes)
  const gitTools: AgentToolDescriptor[] =
    cap?.gitReadEnabled === true
      ? [
          coreTool("git_status", "vcs_tool", "read"),
          coreTool("git_diff", "vcs_tool", "read")
        ]
      : [];

  // Phase D: network read tools (both context modes, execution)
  const networkTools: AgentToolDescriptor[] =
    cap?.networkReadEnabled === true
      ? [
          coreTool("web_search", "network_tool", "external_read"),
          coreTool("fetch_url", "network_tool", "external_read")
        ]
      : [];

  return [
    ...readTools,
    ...searchTools,
    coreTool(
      input.contextMode === "writing" ? "propose_chapter_write" : "propose_file_write",
      "file_tool",
      "propose"
    ),
    ...fileLifecycleTools,
    ...executionTools,
    ...gitTools,
    ...networkTools,
    coreTool("finish", "protocol_action", "control"),
    coreTool("request_user_input", "protocol_action", "control")
  ];
}

/** Build a fully-populated descriptor for a static core tool. */
function coreTool(
  name: StaticAgentToolName,
  kind: AgentToolKind,
  effect: AgentToolEffect
): AgentToolDescriptor {
  return {
    id: name,
    name,
    providerName: name,
    displayName: displayNameFor(name),
    description: descriptionFor(name),
    kind,
    effect,
    dataEgress: dataEgressFor(effect),
    destructive: isDestructive(name),
    retrySemantics: retrySemanticsFor(effect),
    source: { kind: "core", id: name },
    inputSchema: inputSchemaFor(name as AgentToolName),
    descriptorDigest: ""
  };
}

function dataEgressFor(effect: AgentToolEffect): AgentToolDataEgress {
  if (effect === "external_read") return "provider_query";
  if (effect === "external_action") return "remote_tool_arguments";
  return "none";
}

function retrySemanticsFor(effect: AgentToolEffect): AgentToolRetrySemantics {
  if (effect === "external_action") return "idempotency_key_required";
  if (effect === "execute") return "idempotency_key_required";
  return "safe";
}

function isDestructive(name: StaticAgentToolName): boolean {
  return (
    name === "propose_file_delete" ||
    name === "propose_file_move" ||
    name === "run_project_task"
  );
}

function displayNameFor(name: StaticAgentToolName): string {
  const labels: Partial<Record<StaticAgentToolName, string>> = {
    list_project_entries: "列出项目条目",
    read_chapter: "读取章节",
    read_story_bible: "读取 Story Bible",
    read_project_text: "读取项目文本",
    propose_chapter_write: "提案修改章节",
    propose_file_write: "提案修改文件",
    finish: "完成运行",
    finish_plan: "完成规划",
    request_user_input: "请求用户输入",
    search_project_text: "搜索项目文本",
    find_project_references: "查找引用",
    propose_chapter_create: "提案创建章节",
    propose_story_bible_write: "提案写入 Story Bible",
    propose_file_create: "提案创建文件",
    propose_file_move: "提案移动文件",
    propose_file_delete: "提案删除文件",
    propose_directory_create: "提案创建目录",
    run_project_task: "运行项目任务",
    git_status: "Git 状态",
    git_diff: "Git Diff",
    web_search: "网络搜索",
    fetch_url: "获取 URL"
  };
  return labels[name] ?? name;
}

function descriptionFor(name: StaticAgentToolName): string {
  const descs: Partial<Record<StaticAgentToolName, string>> = {
    list_project_entries: "列出指定目录下的项目文件条目。",
    read_chapter: "按章节 ID 读取章节正文。",
    read_story_bible: "按资产 ID 读取 Story Bible 条目。",
    read_project_text: "按项目相对路径读取文本文件。",
    propose_chapter_write: "提案修改章节内容，进入 Change Set 审批流程。",
    propose_file_write: "提案修改文本文件，进入 Change Set 审批流程。",
    finish: "声明当前执行运行已完成。",
    finish_plan: "提交规划结果。",
    request_user_input: "向用户请求澄清信息。",
    search_project_text: "在项目内进行有界全文搜索。",
    find_project_references: "查找章节或资产的引用。",
    propose_chapter_create: "提案创建新章节。",
    propose_story_bible_write: "提案新增或修改 Story Bible 资产。",
    propose_file_create: "提案创建新 UTF-8 文本文件。",
    propose_file_move: "提案移动或重命名文件。",
    propose_file_delete: "提案删除文件（始终需要人工确认）。",
    propose_directory_create: "提案创建项目内目录。",
    run_project_task: "在沙箱内运行预授权的项目任务。",
    git_status: "以结构化格式返回 Git 仓库状态（只读）。",
    git_diff: "返回指定路径的 Git diff（只读）。",
    web_search: "通过配置的搜索提供商执行网络搜索。",
    fetch_url: "获取 HTTP(S) URL 的有界文本内容。"
  };
  return descs[name] ?? "";
}

export function validateAgentToolArguments(input: {
  readonly descriptor: AgentToolDescriptor;
  readonly arguments: JsonObject;
  readonly argumentsText: string;
}): AgentToolArgumentsValidation {
  if (new TextEncoder().encode(input.argumentsText).byteLength > MAX_AGENT_TOOL_ARGUMENT_BYTES) {
    return { ok: false, error: "Tool arguments exceed the size budget." };
  }
  return validateSchemaValue(input.descriptor.inputSchema, input.arguments)
    ? { ok: true }
    : { ok: false, error: "Tool arguments do not match the registered JSON Schema." };
}

function inputSchemaFor(name: AgentToolName | StaticAgentToolName): JsonObject {
  if (name === "propose_chapter_write") {
    return proposalSchema("chapterId");
  }
  if (name === "propose_file_write") {
    return proposalSchema("path");
  }
  if (name === "read_chapter") return strictStringObject("chapterId");
  if (name === "read_story_bible") return strictStringObject("assetId");
  if (name === "read_project_text") return strictStringObject("path");
  if (name === "list_project_entries") {
    return {
      type: "object",
      additionalProperties: false,
      properties: { path: { type: "string", maxLength: 1024 } }
    };
  }
  // Phase D: network tools
  if (name === "web_search") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        maxResults: { type: "integer", minimum: 1, maximum: 10 }
      }
    };
  }
  if (name === "fetch_url") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", minLength: 1, maxLength: 2048 },
        maxBytes: { type: "integer", minimum: 1, maximum: 1048576 }
      }
    };
  }
  // Phase C: run_project_task
  if (name === "run_project_task") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9_-]+$" },
        parameters: {
          type: "object",
          additionalProperties: true
        }
      }
    };
  }
  // Phase C: git_status
  if (name === "git_status") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {}
    };
  }
  // Phase C: git_diff
  if (name === "git_diff") {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        paths: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 1024 },
          maxItems: 50
        }
      }
    };
  }
  return { type: "object", additionalProperties: true };
}

function proposalSchema(targetKey: "chapterId" | "path"): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: [targetKey, "baseHash", "range", "replacement"],
    properties: {
      [targetKey]: { type: "string", minLength: 1, maxLength: 1024 },
      baseHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      range: {
        type: "object",
        additionalProperties: false,
        required: ["unit", "start", "end"],
        properties: {
          unit: { type: "string", enum: ["character", "line", "paragraph"] },
          start: { type: "integer", minimum: 0 },
          end: { type: "integer", minimum: 0 }
        }
      },
      replacement: { type: "string", maxLength: 1_000_000 }
    }
  };
}

function strictStringObject(key: string): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: [key],
    properties: { [key]: { type: "string", minLength: 1, maxLength: 1024 } }
  };
}

function validateSchemaValue(schema: JsonObject, value: unknown): boolean {
  const type = schema["type"];
  if (type === "object") {
    if (!isObject(value)) return false;
    const properties = isObject(schema["properties"]) ? schema["properties"] : {};
    const required = Array.isArray(schema["required"])
      ? schema["required"].filter((key): key is string => typeof key === "string")
      : [];
    if (required.some((key) => !(key in value))) return false;
    if (
      schema["additionalProperties"] === false &&
      Object.keys(value).some((key) => !(key in properties))
    ) {
      return false;
    }
    return Object.entries(value).every(([key, child]) => {
      const childSchema = properties[key];
      return !isObject(childSchema) || validateSchemaValue(childSchema, child);
    });
  }
  if (type === "string") {
    if (typeof value !== "string") return false;
    if (typeof schema["minLength"] === "number" && value.length < schema["minLength"]) return false;
    if (typeof schema["maxLength"] === "number" && value.length > schema["maxLength"]) return false;
    if (typeof schema["pattern"] === "string" && !new RegExp(schema["pattern"]).test(value)) {
      return false;
    }
    return !Array.isArray(schema["enum"]) || schema["enum"].includes(value);
  }
  if (type === "integer") {
    return (
      Number.isInteger(value) &&
      (typeof schema["minimum"] !== "number" || Number(value) >= schema["minimum"])
    );
  }
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") {
    if (!Array.isArray(value)) return false;
    const itemSchema = schema["items"];
    return !isObject(itemSchema) || value.every((item) => validateSchemaValue(itemSchema, item));
  }
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
