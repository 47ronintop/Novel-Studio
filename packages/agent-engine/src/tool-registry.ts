import type { AgentContextMode, AgentOperationMode, AgentWritePolicy } from "./agent-run-types.js";

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
}

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
  return { name, kind: "file_tool", effect };
}

function protocolAction(name: AgentToolName): AgentToolDescriptor {
  return { name, kind: "protocol_action", effect: "control" };
}
