import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import * as runtimeExports from "../src/main/agent-run-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop Agent Run runtime", () => {
  test("uses project-root-bound real reads and finishes a read-only planning run", async () => {
    const createRuntime = (runtimeExports as unknown as Record<string, unknown>)[
      "createDesktopAgentRunSession"
    ];
    expect(typeof createRuntime).toBe("function");
    if (typeof createRuntime !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-run-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterPath = join(projectRoot, "chapters", "chapter-01.md");
    const original = "---\nid: chapter-01\n---\n\nChapter body.\n";
    await writeFile(chapterPath, original, "utf8");

    const session = (
      createRuntime as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      projectRoot,
      projectId: "project-01",
      activeChapterId: "chapter-01",
      createRunId: () => "run-desktop-plan"
    });
    await session.startAgentRun({
      projectId: "project-01",
      commandId: "start-desktop-plan",
      expectedRunRevision: 0,
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "检查章节并制定修订计划。",
      providerCapabilitySnapshot: {
        profileId: "demo-agent",
        provider: "demo",
        modelName: "desktop-scripted-agent",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128000,
        requiredContextTokens: 8000
      }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-plan")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "plan_ready" },
          events: expect.arrayContaining([
            expect.objectContaining({ type: "assistant_text_delta" }),
            expect.objectContaining({
              type: "tool_completed",
              detail: expect.objectContaining({ toolName: "list_project_entries" })
            }),
            expect.objectContaining({
              type: "tool_completed",
              detail: expect.objectContaining({ toolName: "read_chapter" })
            }),
            expect.objectContaining({ type: "plan_ready" })
          ])
        }
      });
    });
    expect(await readFile(chapterPath, "utf8")).toBe(original);
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "agent-runs", "run-desktop-plan", "run.json"),
          "utf8"
        )
      )
    ).toMatchObject({ runId: "run-desktop-plan", status: "plan_ready" });
  });
});
