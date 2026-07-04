import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk, type JsonObject } from "@novel-studio/shared";

import { ConfigAssetRepository, HistoryRepository } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ConfigAssetRepository", () => {
  test("saves a prompt template after snapshotting the previous active version", async () => {
    const projectRoot = await createConfigProject();
    const repository = createRepository(projectRoot, ["ver_prompt_before_save"]);
    const nextPrompt = {
      ...(await readJson(join(projectRoot, "prompts", "prompt_reviewer_default.json"))),
      title: "Updated Reviewer Prompt",
      template: "Review the chapter using the provided context bundle.",
      updatedAt: "2026-07-04T00:00:00.000Z"
    };

    const saved = await repository.writeConfigAsset({
      assetType: "prompt",
      assetId: "prompt_reviewer_default",
      content: nextPrompt,
      createdBy: "user"
    });

    expect(isOk(saved)).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(
      await readFile(
        join(
          projectRoot,
          "history",
          "prompts",
          "prompt_reviewer_default",
          "ver_prompt_before_save.json"
        ),
        "utf8"
      )
    ).toContain("Default Reviewer Prompt");
    expect(
      await readFile(join(projectRoot, "prompts", "prompt_reviewer_default.json"), "utf8")
    ).toContain("Updated Reviewer Prompt");
  });

  test("rejects invalid active agent config without mutating the current file", async () => {
    const projectRoot = await createConfigProject();
    const before = await readFile(
      join(projectRoot, "agents", "agent_reviewer_default.json"),
      "utf8"
    );
    const repository = createRepository(projectRoot, ["ver_unused"]);
    const unsafeAgent = await readJson(join(projectRoot, "agents", "agent_reviewer_default.json"));
    delete unsafeAgent.outputSchemaId;

    const saved = await repository.writeConfigAsset({
      assetType: "agent",
      assetId: "agent_reviewer_default",
      content: unsafeAgent,
      createdBy: "user"
    });

    expect(isErr(saved)).toBe(true);
    if (saved.ok) {
      return;
    }
    expect(saved.error.code).toBe("CONFIG_ASSET_INVALID");
    expect(await readFile(join(projectRoot, "agents", "agent_reviewer_default.json"), "utf8")).toBe(
      before
    );
  });

  test("restores a workflow version after creating a before-rollback snapshot", async () => {
    const projectRoot = await createConfigProject();
    const repository = createRepository(projectRoot, ["ver_old_workflow", "ver_before_rollback"]);
    const workflowPath = join(projectRoot, "workflow", "wf_review_chapter.json");
    const oldWorkflow = await readFile(workflowPath, "utf8");
    const nextWorkflow = {
      ...(await readJson(workflowPath)),
      title: "Changed Workflow",
      updatedAt: "2026-07-04T00:00:00.000Z"
    };
    const saved = await repository.writeConfigAsset({
      assetType: "workflow",
      assetId: "wf_review_chapter",
      content: nextWorkflow,
      createdBy: "user"
    });
    expect(isOk(saved)).toBe(true);

    const restored = await repository.restoreConfigAssetVersion({
      assetType: "workflow",
      assetId: "wf_review_chapter",
      versionId: "ver_old_workflow",
      createdBy: "user"
    });

    expect(isOk(restored)).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(await readFile(workflowPath, "utf8")).toBe(oldWorkflow);
    expect(
      await readFile(
        join(projectRoot, "history", "workflow", "wf_review_chapter", "ver_before_rollback.json"),
        "utf8"
      )
    ).toContain("Changed Workflow");
  });
});

function createRepository(projectRoot: string, versionIds: string[]): ConfigAssetRepository {
  const historyRepository = new HistoryRepository({
    projectRoot,
    traceId: "trace_config_history",
    now: () => "2026-07-04T00:00:00.000Z",
    createVersionId: () => versionIds.shift() ?? "ver_extra"
  });
  return new ConfigAssetRepository({
    projectRoot,
    traceId: "trace_config_asset",
    historyRepository
  });
}

async function createConfigProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-config-"));
  tempRoots.push(root);
  await mkdir(join(root, "prompts"), { recursive: true });
  await mkdir(join(root, "agents"), { recursive: true });
  await mkdir(join(root, "workflow"), { recursive: true });
  await writeFixture(root, "prompt-template", join("prompts", "prompt_reviewer_default.json"));
  const promptPath = join(root, "prompts", "prompt_reviewer_default.json");
  const prompt = await readJson(promptPath);
  await writeFile(
    promptPath,
    `${JSON.stringify(
      {
        ...prompt,
        id: "prompt_reviewer_default",
        title: "Default Reviewer Prompt",
        promptRole: "reviewer"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFixture(root, "agent-config", join("agents", "agent_reviewer_default.json"));
  await writeFixture(root, "workflow-definition", join("workflow", "wf_review_chapter.json"));
  return root;
}

async function writeFixture(
  root: string,
  fixtureName: string,
  relativePath: string
): Promise<void> {
  const content = await readFile(
    join(process.cwd(), "fixtures", "schemas", "valid", `${fixtureName}.json`),
    "utf8"
  );
  await writeFile(join(root, relativePath), content, "utf8");
}

async function readJson(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}
