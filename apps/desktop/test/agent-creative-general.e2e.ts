import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveChangeSetThroughTrustedUi,
  configureLocalModelThroughUi,
  controlExistsThroughUi,
  expandCreativeProjectDirectoryThroughUi,
  launchPackagedAgentApplication,
  openCreativeProjectFileThroughUi,
  readControlTextThroughUi,
  saveFirstUseSharingAndRestartRun,
  selectCreativeProjectFilesContextThroughUi,
  startAgentRunThroughUi,
  undoAgentRunThroughUi,
  waitForControl
} from "./helpers/packaged-agent-approval.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures", "projects", "minimal-chapter");
const originalDraft = "Original creative draft.\n";
const replacedDraft = "Replaced creative draft.\n";
const movedContent = "Move this creative file.\n";
const obsoleteContent = "Delete this creative file.\n";
const createdContent = "Created by creative_general.\n";

test("uses packaged creative_general Agent to apply and undo the complete text lifecycle", async () => {
  test.setTimeout(300_000);
  const tempRoot = await mkdtemp(join(tmpdir(), "novel-studio-packaged-creative-general-"));
  const projectRoot = join(tempRoot, "Project");
  await cp(fixtureRoot, projectRoot, { recursive: true });
  await mkdir(join(projectRoot, "notes"), { recursive: true });
  const draftPath = join(projectRoot, "notes", "draft.md");
  const createPath = join(projectRoot, "notes", "created.md");
  const moveSourcePath = join(projectRoot, "notes", "move-source.md");
  const moveTargetPath = join(projectRoot, "notes", "moved.md");
  const obsoletePath = join(projectRoot, "notes", "obsolete.md");
  await writeFile(draftPath, originalDraft, "utf8");
  await writeFile(moveSourcePath, movedContent, "utf8");
  await writeFile(obsoletePath, obsoleteContent, "utf8");

  let providerRequests = 0;
  let providerToolNames: readonly string[] = [];
  const roundGates = {
    2: createRoundGate(),
    3: createRoundGate(),
    4: createRoundGate(),
    5: createRoundGate()
  } as const;
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
    if (providerRequests === 1) providerToolNames = toolNamesFromProviderRequest(body);
    await gateForRound(roundGates, providerRequests)?.wait;
    sendToolCalls(response, [toolCallForRound(providerRequests)]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected local provider address.");
  }
  const application = await launchPackagedAgentApplication(
    electronEnv({
      NOVEL_STUDIO_PROJECT_ROOT: projectRoot,
      NOVEL_STUDIO_USER_DATA_ROOT: join(tempRoot, "User Data")
    })
  );

  try {
    await configureLocalModelThroughUi(application, `http://127.0.0.1:${address.port}/v1`);
    await selectCreativeProjectFilesContextThroughUi(application);
    await expandCreativeProjectDirectoryThroughUi(application, "notes");
    await openCreativeProjectFileThroughUi(application, "draft.md");
    await expect
      .poll(() => readControlTextThroughUi(application, "普通文件正文"), { timeout: 30_000 })
      .toContain("Original creative draft.");
    const request = "依次修改、新建、移动并删除指定项目文本文件";
    await startAgentRunThroughUi(application, request);
    await saveFirstUseSharingAndRestartRun(application, request);
    await expect
      .poll(() => providerToolNames, { timeout: 30_000 })
      .toEqual(
        expect.arrayContaining([
          "edit_text",
          "create_resource",
          "propose_file_move",
          "propose_file_delete"
        ])
      );
    expect(providerToolNames).not.toContain("manage_path");

    await applyNextChangeSet(application);
    await expect.poll(() => readFile(draftPath, "utf8"), { timeout: 30_000 }).toBe(replacedDraft);
    await expect
      .poll(() => readControlTextThroughUi(application, "普通文件正文"), { timeout: 30_000 })
      .toContain("Replaced creative draft.");
    roundGates[2].release();

    await applyNextChangeSet(application);
    await expect.poll(() => readFile(createPath, "utf8"), { timeout: 30_000 }).toBe(createdContent);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：created.md"), {
        timeout: 30_000
      })
      .toBe(true);

    await openCreativeProjectFileThroughUi(application, "move-source.md");
    roundGates[3].release();

    await applyNextChangeSet(application);
    await expect.poll(() => pathExists(moveTargetPath), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => pathExists(moveSourcePath), { timeout: 30_000 }).toBe(false);
    expect(await readFile(moveTargetPath, "utf8")).toBe(movedContent);
    await waitForControl(application, "moved.md");
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：moved.md"), {
        timeout: 30_000
      })
      .toBe(true);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：move-source.md"), {
        timeout: 30_000
      })
      .toBe(false);

    await openCreativeProjectFileThroughUi(application, "obsolete.md");
    roundGates[4].release();

    await applyNextChangeSet(application);
    await expect.poll(() => pathExists(obsoletePath), { timeout: 30_000 }).toBe(false);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：obsolete.md"), {
        timeout: 30_000
      })
      .toBe(false);
    await expect
      .poll(() => controlExistsThroughUi(application, "普通文件编辑器"), { timeout: 30_000 })
      .toBe(false);
    roundGates[5].release();

    await waitForControl(application, "撤销本次运行");
    await undoAgentRunThroughUi(application);
    await expect.poll(() => readFile(draftPath, "utf8"), { timeout: 30_000 }).toBe(originalDraft);
    await expect.poll(() => pathExists(createPath), { timeout: 30_000 }).toBe(false);
    await expect
      .poll(() => readFile(moveSourcePath, "utf8"), { timeout: 30_000 })
      .toBe(movedContent);
    await expect.poll(() => pathExists(moveTargetPath), { timeout: 30_000 }).toBe(false);
    await expect
      .poll(() => readFile(obsoletePath, "utf8"), { timeout: 30_000 })
      .toBe(obsoleteContent);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：created.md"), {
        timeout: 30_000
      })
      .toBe(false);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：move-source.md"), {
        timeout: 30_000
      })
      .toBe(true);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：moved.md"), {
        timeout: 30_000
      })
      .toBe(false);
    await expect
      .poll(() => controlExistsThroughUi(application, "打开文件：obsolete.md"), {
        timeout: 30_000
      })
      .toBe(true);
  } finally {
    Object.values(roundGates).forEach((gate) => gate.release());
    await application.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    );
    await rm(tempRoot, { recursive: true, force: true });
  }
});

interface RoundGate {
  readonly wait: Promise<void>;
  release(): void;
}

function createRoundGate(): RoundGate {
  let released = false;
  let resolve = () => undefined;
  const wait = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    wait,
    release() {
      if (released) return;
      released = true;
      resolve();
    }
  };
}

function gateForRound(
  gates: Readonly<Record<2 | 3 | 4 | 5, RoundGate>>,
  round: number
): RoundGate | undefined {
  return round === 2 || round === 3 || round === 4 || round === 5 ? gates[round] : undefined;
}

async function applyNextChangeSet(
  application: Parameters<typeof waitForControl>[0]
): Promise<void> {
  await waitForControl(application, "应用所选");
  await approveChangeSetThroughTrustedUi(application);
}

function toolCallForRound(round: number): {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
} {
  switch (round) {
    case 1:
      return {
        id: "replace-creative-file",
        name: "edit_text",
        arguments: {
          ref: "file:notes/draft.md",
          baseHash: sha256(originalDraft),
          range: { unit: "character", start: 0, end: originalDraft.length },
          replacement: replacedDraft
        }
      };
    case 2:
      return {
        id: "create-creative-file",
        name: "create_resource",
        arguments: {
          kind: "file",
          ref: "file:notes/created.md",
          content: createdContent
        }
      };
    case 3:
      return {
        id: "move-creative-file",
        name: "propose_file_move",
        arguments: {
          sourceRef: "file:notes/move-source.md",
          targetRef: "file:notes/moved.md",
          baseHash: sha256(movedContent)
        }
      };
    case 4:
      return {
        id: "delete-creative-file",
        name: "propose_file_delete",
        arguments: {
          ref: "file:notes/obsolete.md",
          baseHash: sha256(obsoleteContent)
        }
      };
    default:
      return {
        id: "finish-creative-lifecycle",
        name: "finish",
        arguments: { summary: "Creative file lifecycle completed." }
      };
  }
}

function electronEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  return { ...env, ...overrides };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
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

function toolNamesFromProviderRequest(body: Record<string, unknown>): readonly string[] {
  const tools = body["tools"];
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (
      typeof tool !== "object" ||
      tool === null ||
      Array.isArray(tool) ||
      typeof tool["function"] !== "object" ||
      tool["function"] === null ||
      Array.isArray(tool["function"]) ||
      typeof tool["function"]["name"] !== "string"
    ) {
      return [];
    }
    return [tool["function"]["name"]];
  });
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
