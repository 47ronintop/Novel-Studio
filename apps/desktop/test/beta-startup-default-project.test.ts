import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { HistoryRepository, type WorkflowRunRecord } from "@novel-studio/repository";

import {
  createBootstrappedDefaultDesktopApplication,
  createBootstrappedDefaultDesktopApplicationWithSnapshot,
  DEFAULT_FIXTURE_CHAPTER_ID
} from "../src/main/application-composition.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("beta startup default project", () => {
  test("uses the canonical project root for the workspace and project lock", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-canonical-default-"));
    tempRoots.push(projectRoot);
    const bootstrapped = await createBootstrappedDefaultDesktopApplicationWithSnapshot({
      projectRoot,
      projectLockOwnerId: "desktop-canonical-owner"
    });
    const canonicalRoot = await realpath(projectRoot);
    const lock = JSON.parse(
      await readFile(join(projectRoot, ".novel-studio", "project-lock.json"), "utf8")
    ) as { readonly projectRoot: string };

    expect(bootstrapped.workspace.projectRoot).toBe(canonicalRoot);
    expect(lock.projectRoot).toBe(canonicalRoot);
    await bootstrapped.application.shutdown();
  });

  test("bootstraps a writable default project without relying on source fixtures", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-empty-default-"));
    tempRoots.push(projectRoot);

    const application = await createBootstrappedDefaultDesktopApplication({
      projectRoot,
      now: () => "2026-07-05T00:00:00.000Z"
    });

    const shellState = application.getShellState();
    const loaded = await application.loadActiveChapter();
    const chapters = await application.listProjectChapters();

    expect(shellState.projectTitle).toBe("未命名长篇项目");
    expect(shellState.workspaceContext).toMatchObject({
      kind: "creativeProject",
      workspaceId: "prj_minimal_chapter",
      projectId: "prj_minimal_chapter",
      displayName: "未命名长篇项目"
    });
    expect(shellState.navigatorSections.find((section) => section.id === "chapters")).toMatchObject(
      {
        itemCount: 1
      }
    );
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        state: {
          chapter: {
            frontmatter: {
              id: DEFAULT_FIXTURE_CHAPTER_ID,
              title: "第一章"
            },
            body: "这是第一章的正文。你可以直接开始写作。\n"
          },
          saveStatus: "Saved"
        }
      }
    });
    expect(chapters).toMatchObject({
      ok: true,
      value: [
        {
          id: DEFAULT_FIXTURE_CHAPTER_ID,
          title: "第一章"
        }
      ]
    });
  });

  test("releases the bootstrapped project lock during shutdown", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-lock-default-"));
    tempRoots.push(projectRoot);

    const application = await createBootstrappedDefaultDesktopApplication({
      projectRoot,
      now: () => "2026-07-06T00:00:00.000Z"
    });

    await expect(access(join(projectRoot, ".novel-studio", "project-lock.json"))).resolves.toBe(
      undefined
    );

    const shutdown = await application.shutdown();

    expect(shutdown).toEqual({ ok: true, value: undefined });
    await expect(access(join(projectRoot, ".novel-studio", "project-lock.json"))).rejects.toThrow();
  });

  test("routes project-scoped settings, Story Bible, and Studio writes to the committed project", async () => {
    const projectA = await mkdtemp(join(tmpdir(), "novel-studio-project-a-"));
    const parentB = await mkdtemp(join(tmpdir(), "novel-studio-project-b-parent-"));
    tempRoots.push(projectA, parentB);
    const application = await createBootstrappedDefaultDesktopApplication({
      projectRoot: projectA,
      now: () => "2026-07-19T01:00:00.000Z",
      createVersionId: () => "ver_project_b"
    });
    expect(
      await application.saveStoryBibleAsset({
        schemaVersion: "1.0",
        id: "chr_project_a",
        type: "character",
        title: "Project A Hero",
        status: "active",
        summary: "Only belongs to project A.",
        createdAt: "2026-07-19T01:00:00.000Z",
        updatedAt: "2026-07-19T01:00:00.000Z"
      })
    ).toMatchObject({ ok: true });
    expect(
      application.getShellState().navigatorSections.find((section) => section.id === "characters")
        ?.itemCount
    ).toBe(1);
    await writePluginRegistry(projectA, "plugin.project-a", true);
    expect(
      await new HistoryRepository({ projectRoot: projectA }).recordWorkflowRun(
        workflowRunRecord("wfrun_project_a", "Project A Workflow")
      )
    ).toMatchObject({ ok: true });
    const prepared = await application.prepareCreateCreativeProject({
      parentDirectory: parentB,
      folderName: "project-b",
      projectId: "prj_project_b",
      title: "Project B",
      language: "en"
    });
    if (!prepared.ok || !("creativeProject" in prepared.value)) {
      throw new Error(
        prepared.ok ? "Creative project candidate expected." : prepared.error.message
      );
    }
    const projectB = prepared.value.context.contentRoot;
    await writePluginRegistry(projectB, "plugin.project-b", true);
    expect(
      await new HistoryRepository({ projectRoot: projectB }).recordWorkflowRun(
        workflowRunRecord("wfrun_project_b", "Project B Workflow")
      )
    ).toMatchObject({ ok: true });
    application.commitWorkspaceActivation(prepared.value.activationId);
    expect(await application.finalizeWorkspaceActivation(prepared.value.activationId)).toEqual({
      ok: true,
      value: undefined
    });
    expect(
      application.getShellState().navigatorSections.find((section) => section.id === "characters")
        ?.itemCount
    ).toBe(0);

    expect(
      await application.saveModelProfile(
        {
          id: "model_project_b",
          provider: "openai-compatible",
          displayName: "Project B Model",
          apiKeyRef: "secret://project-b/api-key",
          modelName: "project-b-model",
          temperature: 0.4,
          maxTokens: 2048,
          timeoutMs: 60_000
        },
        { makeDefault: true }
      )
    ).toMatchObject({ ok: true });
    expect(
      await application.saveStoryBibleAsset({
        schemaVersion: "1.0",
        id: "chr_project_b",
        type: "character",
        title: "Project B Hero",
        status: "active",
        summary: "Only belongs to project B.",
        createdAt: "2026-07-19T01:00:00.000Z",
        updatedAt: "2026-07-19T01:00:00.000Z"
      })
    ).toMatchObject({ ok: true });
    expect(await application.loadPluginRegistry()).toMatchObject({
      ok: true,
      value: { plugins: [{ pluginId: "plugin.project-b", enabled: true }] }
    });
    expect(await application.setPluginEnabled("plugin.project-b", false)).toMatchObject({
      ok: true,
      value: { plugins: [{ pluginId: "plugin.project-b", enabled: false }] }
    });
    expect(await application.listWorkflowRuns()).toMatchObject({
      ok: true,
      value: [{ workflowRunId: "wfrun_project_b", workflowTitle: "Project B Workflow" }]
    });
    expect(await application.readWorkflowRun("wfrun_project_b")).toMatchObject({
      ok: true,
      value: { workflowRunId: "wfrun_project_b" }
    });
    const promptB = JSON.parse(
      await readFile(join(projectB, "prompts", "prompt_reviewer_default.json"), "utf8")
    ) as Record<string, unknown>;
    expect(
      await application.saveConfigAsset({
        assetType: "prompt",
        assetId: "prompt_reviewer_default",
        content: {
          ...promptB,
          title: "Project B Reviewer Prompt",
          updatedAt: "2026-07-19T01:00:00.000Z"
        },
        createdBy: "user"
      })
    ).toMatchObject({ ok: true });

    const settingsA = JSON.parse(await readFile(join(projectA, "settings.json"), "utf8")) as {
      models: { profiles: { id: string }[] };
    };
    const settingsB = JSON.parse(await readFile(join(projectB, "settings.json"), "utf8")) as {
      models: { profiles: { id: string }[] };
    };
    const promptAAfter = JSON.parse(
      await readFile(join(projectA, "prompts", "prompt_reviewer_default.json"), "utf8")
    ) as { title: string };
    const promptBAfter = JSON.parse(
      await readFile(join(projectB, "prompts", "prompt_reviewer_default.json"), "utf8")
    ) as { title: string };
    const pluginRegistryA = JSON.parse(
      await readFile(join(projectA, "plugins", "plugins.json"), "utf8")
    ) as { plugins: { pluginId: string; enabled: boolean }[] };
    const pluginRegistryB = JSON.parse(
      await readFile(join(projectB, "plugins", "plugins.json"), "utf8")
    ) as { plugins: { pluginId: string; enabled: boolean }[] };

    expect(settingsA.models.profiles.some((profile) => profile.id === "model_project_b")).toBe(
      false
    );
    expect(settingsB.models.profiles).toContainEqual(
      expect.objectContaining({ id: "model_project_b" })
    );
    await expect(access(join(projectA, "characters", "chr_project_b.json"))).rejects.toThrow();
    await expect(access(join(projectB, "characters", "chr_project_b.json"))).resolves.toBe(
      undefined
    );
    expect(promptAAfter.title).toBe("默认审稿 Prompt");
    expect(promptBAfter.title).toBe("Project B Reviewer Prompt");
    expect(pluginRegistryA.plugins).toContainEqual({
      pluginId: "plugin.project-a",
      enabled: true,
      manifestPath: "plugins/plugin.project-a/plugin.json",
      grantedPermissions: []
    });
    expect(pluginRegistryB.plugins).toContainEqual({
      pluginId: "plugin.project-b",
      enabled: false,
      manifestPath: "plugins/plugin.project-b/plugin.json",
      grantedPermissions: []
    });
    expect(await application.shutdown()).toEqual({ ok: true, value: undefined });
  });
});

async function writePluginRegistry(
  projectRoot: string,
  pluginId: string,
  enabled: boolean
): Promise<void> {
  await writeFile(
    join(projectRoot, "plugins", "plugins.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        plugins: [
          {
            pluginId,
            enabled,
            manifestPath: `plugins/${pluginId}/plugin.json`,
            grantedPermissions: []
          }
        ]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function workflowRunRecord(workflowRunId: string, workflowTitle: string): WorkflowRunRecord {
  return {
    schemaVersion: "1.0",
    workflowRunId,
    workflowId: "wf_project_binding",
    workflowTitle,
    status: "pending-confirmation",
    startedAt: "2026-07-19T01:00:00.000Z",
    updatedAt: "2026-07-19T01:00:01.000Z",
    context: {
      sourceCount: 1,
      tokenEstimate: 4,
      selectionReason: "Verify project binding."
    },
    model: {
      profileId: "model_project_binding",
      displayName: "Project Binding Model",
      provider: "mock",
      modelName: "project-binding"
    },
    usage: {
      inputTokens: 4,
      outputTokens: 4,
      totalTokens: 8,
      usageStatus: "estimated",
      cost: { amount: 0, currency: "USD", status: "estimated" }
    },
    steps: [
      {
        stepId: "confirm",
        label: "Confirm",
        kind: "confirmation",
        status: "waiting-confirmation"
      }
    ]
  };
}
