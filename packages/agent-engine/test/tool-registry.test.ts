import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent tool registry", () => {
  test("exposes the exact operation and context mode matrices", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"];
    expect(typeof listTools).toBe("function");
    if (typeof listTools !== "function") return;

    const names = (operationMode: string, contextMode: string, writePolicy: string) =>
      (
        listTools({ operationMode, contextMode, writePolicy }) as readonly {
          readonly name: string;
        }[]
      ).map((tool) => tool.name);

    expect(names("planning", "writing", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_chapter",
      "read_story_bible",
      "read_project_text",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("planning", "general_file", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_project_text",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("execution", "writing", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_chapter",
      "read_story_bible",
      "read_project_text",
      "propose_chapter_write",
      "finish",
      "request_user_input"
    ]);
    expect(names("execution", "general_file", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_project_text",
      "propose_file_write",
      "finish",
      "request_user_input"
    ]);
    expect(names("execution", "general_file", "user_preapproved_run")).toEqual(
      names("execution", "general_file", "write_before_confirmation")
    );
  });
});
