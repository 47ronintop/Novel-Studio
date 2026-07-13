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

  test("publishes and enforces bounded proposal argument schemas", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string; readonly inputSchema: Record<string, unknown> }[];
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentToolArguments"
    ] as
      | ((input: {
          descriptor: { readonly name: string; readonly inputSchema: Record<string, unknown> };
          arguments: Record<string, unknown>;
          argumentsText: string;
        }) => { readonly ok: boolean })
      | undefined;
    expect(typeof validate).toBe("function");
    if (validate === undefined) return;
    const descriptor = listTools({
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation"
    }).find((tool) => tool.name === "propose_file_write");
    expect(descriptor?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["path", "baseHash", "range", "replacement"]
    });
    if (descriptor === undefined) throw new Error("Missing proposal descriptor.");
    const validArguments = {
      path: "notes/outline.md",
      baseHash: "a".repeat(64),
      range: { unit: "character", start: 0, end: 1 },
      replacement: "x"
    };
    expect(
      validate({ descriptor, arguments: validArguments, argumentsText: JSON.stringify(validArguments) })
    ).toMatchObject({ ok: true });
    expect(
      validate({
        descriptor,
        arguments: { ...validArguments, baseHash: "not-a-hash", absolutePath: "C:/escape" },
        argumentsText: "{}"
      })
    ).toMatchObject({ ok: false });
    const oversized = { ...validArguments, replacement: "x".repeat(1_048_577) };
    expect(
      validate({ descriptor, arguments: oversized, argumentsText: JSON.stringify(oversized) })
    ).toMatchObject({ ok: false });
  });
});
