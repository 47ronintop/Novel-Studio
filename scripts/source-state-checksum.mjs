import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;

export async function sourceStateChecksum(root) {
  const hash = createHash("sha256");
  hash.update("novel-studio-source-state@1.0\0");
  // Hash the working-tree contents of changed paths instead of diff bytes. This keeps the
  // fingerprint stable when a developer stages a change between build and test:e2e:built.
  const changed = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES
  })
    .split("\0")
    .filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES
  })
    .split("\0")
    .filter(Boolean);

  const paths = [...new Set([...changed, ...untracked])].sort((left, right) =>
    left.localeCompare(right)
  );
  for (const path of paths) {
    const absolutePath = resolve(root, path);
    const relativePath = relative(root, absolutePath);
    if (relativePath.length === 0 || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      throw new Error("SOURCE_STATE_PATH_INVALID");
    }
    let info;
    try {
      info = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        hash.update("\0deleted\0");
        hash.update(path.replaceAll("\\", "/"));
        continue;
      }
      throw error;
    }
    hash.update("\0path\0");
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    if (info.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await readlink(absolutePath));
    } else if (info.isFile()) {
      hash.update("file\0");
      hash.update(await readFile(absolutePath));
    } else {
      hash.update("other\0");
    }
  }

  return hash.digest("hex");
}
