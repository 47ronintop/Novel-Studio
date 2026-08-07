import { expect, test } from "@playwright/test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveChangeSetThroughTrustedUi,
  configureLocalModelThroughUi,
  launchPackagedAgentApplication,
  type PackagedAgentApplication,
  saveFirstUseSharingAndRestartRun,
  startAgentRunThroughUi,
  undoAgentRunThroughUi,
  waitForControl
} from "./helpers/packaged-agent-approval.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const originalTitle = "第一章";
const renamedTitle = "Agent 改名章节";

test("runs the real chapter rename proposal through apply and undo, refreshing disk and writing UI", async () => {
  test.setTimeout(180_000);
  const scenario = await launchScenario({
    firstToolCalls: [
      {
        id: "rename-chapter",
        name: "rename_chapter",
        arguments: {
          chapterRef: `chapter:${chapterId}`,
          baseRevision: 1,
          title: renamedTitle
        }
      }
    ]
  });
  const chapterPath = join(scenario.projectRoot, "chapters", `${chapterId}.md`);

  try {
    const request = "分析当前章节结构";
    await startAgentRunThroughUi(scenario.application, request);
    await saveFirstUseSharingAndRestartRun(scenario.application, request);
    await expect.poll(() => scenario.executionRequests).toBeGreaterThan(0);
    expect(scenario.providerToolNames).toContain("rename_chapter");

    await waitForControl(scenario.application, "应用所选");
    await approveChangeSetThroughTrustedUi(scenario.application);

    await expect
      .poll(async () => readFile(chapterPath, "utf8"))
      .toContain(`title: "${renamedTitle}"`);
    await waitForControl(scenario.application, renamedTitle);
    await undoAgentRunThroughUi(scenario.application);

    await expect
      .poll(async () => readFile(chapterPath, "utf8"))
      .toContain(`title: "${originalTitle}"`);
    await waitForControl(scenario.application, originalTitle);
    expect(scenario.executionRequests).toBeGreaterThanOrEqual(2);
  } finally {
    await scenario.close();
  }
});

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

interface Scenario {
  readonly application: PackagedAgentApplication;
  readonly projectRoot: string;
  readonly executionRequests: number;
  readonly providerToolNames: readonly string[];
  close(): Promise<void>;
}

async function launchScenario(input: {
  readonly firstToolCalls: readonly ToolCall[];
}): Promise<Scenario> {
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-writing-domain-e2e-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  let executionRequests = 0;
  let providerToolNames: readonly string[] = [];
  const server = createServer(async (request, response) => {
    const body = await readJsonBody(request);
    if (request.method === "GET" && request.url === "/v1/models") {
      json(response, {
        data: [
          {
            id: "local-agent",
            context_window: 128000,
            capabilities: { streaming: true, tool_calling: true, structured_arguments: true }
          }
        ]
      });
      return;
    }
    if (request.method !== "POST" || body["stream"] !== true) {
      json(response, { choices: [{ message: { role: "assistant", content: "ok" } }] });
      return;
    }
    executionRequests += 1;
    if (executionRequests === 1) {
      providerToolNames = toolNamesFromProviderRequest(body);
      sendToolCalls(
        response,
        providerToolNames.includes("rename_chapter")
          ? input.firstToolCalls
          : [{ id: "finish-no-lifecycle", name: "finish", arguments: { summary: "完成。" } }],
        "准备真实章节操作。"
      );
      return;
    }
    sendToolCalls(
      response,
      [{ id: "finish", name: "finish", arguments: { summary: "完成。" } }],
      ""
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address");

  const application = await launchPackagedAgentApplication(
    electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  );
  await configureLocalModelThroughUi(application, `http://127.0.0.1:${address.port}/v1`);

  return {
    application,
    projectRoot,
    get executionRequests() {
      return executionRequests;
    },
    get providerToolNames() {
      return providerToolNames;
    },
    async close() {
      await application.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      );
      await rm(tempRoot, { recursive: true, force: true });
    }
  };
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendToolCalls(
  response: ServerResponse,
  calls: readonly ToolCall[],
  content: string
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content, tool_calls: calls.map((call, index) => ({ index, id: `call_${call.id}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }] })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`
  );
  response.end("data: [DONE]\n\n");
}

function toolNamesFromProviderRequest(body: Record<string, unknown>): readonly string[] {
  const tools = body["tools"];
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (
      !isRecord(tool) ||
      !isRecord(tool["function"]) ||
      typeof tool["function"]["name"] !== "string"
    ) {
      return [];
    }
    return [tool["function"]["name"]];
  });
}
