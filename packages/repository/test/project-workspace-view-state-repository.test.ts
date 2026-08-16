import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { ProjectWorkspaceViewStateFileRepository } from "../src/project-workspace-view-state-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectWorkspaceViewStateFileRepository", () => {
  test("writes and reads the active chapter inside project state", async () => {
    const projectRoot = await createTempRoot();
    const repository = new ProjectWorkspaceViewStateFileRepository({ projectRoot });
    const viewState = {
      schemaVersion: "1.0" as const,
      activeChapterId: "ch_second",
      updatedAt: "2026-08-16T00:00:00.000Z"
    };

    await expect(repository.writeWorkspaceViewState(viewState)).resolves.toEqual({
      ok: true,
      value: viewState
    });
    await expect(repository.readWorkspaceViewState()).resolves.toEqual({
      ok: true,
      value: viewState
    });
  });

  test("treats corrupt or unknown state versions as absent", async () => {
    const projectRoot = await createTempRoot();
    const stateDirectory = join(projectRoot, ".novel-studio");
    const repository = new ProjectWorkspaceViewStateFileRepository({ projectRoot });
    await mkdir(stateDirectory);

    await writeFile(join(stateDirectory, "workspace-view.json"), "not json", "utf8");
    await expect(repository.readWorkspaceViewState()).resolves.toEqual({
      ok: true,
      value: undefined
    });

    await writeFile(
      join(stateDirectory, "workspace-view.json"),
      JSON.stringify({ schemaVersion: "2.0", activeChapterId: "ch_second" }),
      "utf8"
    );
    await expect(repository.readWorkspaceViewState()).resolves.toEqual({
      ok: true,
      value: undefined
    });
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-workspace-view-"));
  tempRoots.push(root);
  return root;
}
