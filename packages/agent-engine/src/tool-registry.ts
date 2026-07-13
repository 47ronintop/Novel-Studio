import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";
import type { JsonObject } from "@novel-studio/shared";

export type AgentToolName =
  | "list_project_entries"
  | "read_chapter"
  | "read_story_bible"
  | "read_project_text"
  | "propose_chapter_write"
  | "propose_file_write"
  | "finish"
  | "finish_plan"
  | "request_user_input";

export interface AgentToolDescriptor {
  readonly name: AgentToolName;
  readonly kind: "file_tool" | "protocol_action";
  readonly effect: "read" | "propose" | "control";
  readonly inputSchema: JsonObject;
}

export type AgentToolArgumentsValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const MAX_AGENT_TOOL_ARGUMENT_BYTES = 1_048_576;

export interface ListAgentToolsInput {
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
}

export function listAgentTools(input: ListAgentToolsInput): readonly AgentToolDescriptor[] {
  const readTools: AgentToolDescriptor[] =
    input.contextMode === "writing"
      ? [
          fileTool("list_project_entries", "read"),
          fileTool("read_chapter", "read"),
          fileTool("read_story_bible", "read"),
          fileTool("read_project_text", "read")
        ]
      : [fileTool("list_project_entries", "read"), fileTool("read_project_text", "read")];

  if (input.operationMode === "planning") {
    return [...readTools, protocolAction("finish_plan"), protocolAction("request_user_input")];
  }

  return [
    ...readTools,
    fileTool(
      input.contextMode === "writing" ? "propose_chapter_write" : "propose_file_write",
      "propose"
    ),
    protocolAction("finish"),
    protocolAction("request_user_input")
  ];
}

function fileTool(name: AgentToolName, effect: AgentToolDescriptor["effect"]): AgentToolDescriptor {
  return { name, kind: "file_tool", effect, inputSchema: inputSchemaFor(name) };
}

function protocolAction(name: AgentToolName): AgentToolDescriptor {
  return { name, kind: "protocol_action", effect: "control", inputSchema: inputSchemaFor(name) };
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

function inputSchemaFor(name: AgentToolName): JsonObject {
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
