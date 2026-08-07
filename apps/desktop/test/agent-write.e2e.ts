import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveChangeSetThroughTrustedUi,
  configureLocalModelThroughUi,
  launchPackagedAgentApplication,
  saveFirstUseSharingAndRestartRun,
  startAgentRunThroughUi,
  undoAgentRunThroughUi,
  waitForControl
} from "./helpers/packaged-agent-approval.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const chapterBody = "原始章节正文。\n";

test("uses packaged UI to save first-use sharing, approve a chapter replacement, and undo it", async () => {
  test.setTimeout(180_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-packaged-agent-write-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
  const before = await readFile(chapterPath, "utf8");
  let providerRequests = 0;
  let proposalSent = false;
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
    providerRequests += 1;
    if (!proposalSent) {
      proposalSent = true;
      sendToolCalls(response, [
        {
          id: "replace-chapter",
          name: "edit_text",
          arguments: {
            ref: `chapter:${chapterId}`,
            baseHash: createHash("sha256").update(chapterBody, "utf8").digest("hex"),
            range: { unit: "character", start: 0, end: 2 },
            replacement: "改写"
          }
        }
      ]);
      return;
    }
    sendToolCalls(response, [{ id: "finish", name: "finish", arguments: { summary: "完成。" } }]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected local provider address.");
  const app = await launchPackagedAgentApplication(
    electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  );

  try {
    await configureLocalModelThroughUi(app, `http://127.0.0.1:${address.port}/v1`);
    const request = "把当前章节开头改写得更有张力";
    await startAgentRunThroughUi(app, request);
    await saveFirstUseSharingAndRestartRun(app, request);
    await expect.poll(() => providerRequests, { timeout: 30_000 }).toBeGreaterThan(0);
    await waitForControl(app, "应用所选");
    expect(await readFile(chapterPath, "utf8")).toBe(before);

    await approveChangeSetThroughTrustedUi(app);
    await expect
      .poll(() => readFile(chapterPath, "utf8"), { timeout: 30_000 })
      .toContain("改写章节正文。");

    await undoAgentRunThroughUi(app);
    await expect.poll(() => readFile(chapterPath, "utf8"), { timeout: 30_000 }).toBe(before);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

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
  const value = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(response: ServerResponse, payload: Record<string, unknown>): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function sendToolCalls(
  response: ServerResponse,
  calls: readonly { readonly id: string; readonly name: string; readonly arguments: unknown }[]
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, id: `call_${call.id}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }] })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`
  );
  response.end("data: [DONE]\n\n");
}
