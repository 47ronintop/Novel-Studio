import { mkdtemp, open, lstat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "novel-studio-runtime-"));
const filePath = join(directory, "identity-probe.txt");

try {
  await writeFile(filePath, "identity probe\n", "utf8");
  const pathnameStats = await lstat(filePath);
  const handle = await open(filePath, "r");
  try {
    const handleStats = await handle.stat();
    const pathnameIdentity = `${String(pathnameStats.dev)}:${String(pathnameStats.ino)}`;
    const handleIdentity = `${String(handleStats.dev)}:${String(handleStats.ino)}`;
    const valid =
      pathnameStats.isFile() &&
      handleStats.isFile() &&
      pathnameStats.dev !== 0 &&
      pathnameStats.ino !== 0 &&
      handleStats.dev !== 0 &&
      handleStats.ino !== 0 &&
      pathnameIdentity === handleIdentity;

    if (!valid) {
      throw new Error(
        `File identity runtime contract unavailable (node=${process.version}, platform=${process.platform}, pathname=${pathnameIdentity}, handle=${handleIdentity}).`
      );
    }
  } finally {
    await handle.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log(`File identity runtime contract passed on ${process.version}.`);
