import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Create a fixture directory with a simulated external gitdir. */
export async function createExternalGitdirFixture(
  tmpBase: string
): Promise<MaliciousGitRepoFixture> {
  const dir = await mkdtemp(join(tmpBase, "malicious-external-gitdir-"));
  const external = await mkdtemp(join(tmpBase, "external-git-store-"));
  await writeFile(join(dir, ".git"), `gitdir: ${external}\n`);
  return {
    name: "external-gitdir",
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  };
}

/** Create a fixture with a path traversal in cwd. */
export async function createPathTraversalFixture(
  tmpBase: string
): Promise<MaliciousGitRepoFixture> {
  const dir = await mkdtemp(join(tmpBase, "malicious-traversal-"));
  return {
    name: "path-traversal",
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** Create a fixture that simulates a config include injection. */
export async function createConfigIncludeFixture(
  tmpBase: string
): Promise<MaliciousGitRepoFixture> {
  const dir = await mkdtemp(join(tmpBase, "malicious-config-include-"));
  await mkdir(join(dir, ".git"), { recursive: true });
  const maliciousConfig = `[core]\n  repositoryformatversion = 0\n[include]\n  path = ../../../etc/gitconfig\n`;
  await writeFile(join(dir, ".git", "config"), maliciousConfig);
  return {
    name: "config-include",
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
