import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const runId = createRunId();
const outputDirectory = `release/package-dir-${runId}`;
const unpackedDirectory = `${outputDirectory}/win-unpacked`;

await mkdir(join(root, "release"), { recursive: true });

await run("npm", ["run", "build"]);
await run("electron-builder", ["--dir", "--config", "apps/desktop/electron-builder.config.cjs"], {
  NOVEL_STUDIO_PACKAGE_OUTPUT: outputDirectory
});
await run("node", ["scripts/artifact-secret-scan.mjs", unpackedDirectory]);
await writeFile(join(root, "release", "latest-package-dir.txt"), `${unpackedDirectory}\n`, "utf8");

console.log(`Package directory ready: ${unpackedDirectory}`);

function createRunId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...process.env,
        ...extraEnv
      },
      shell: true,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}
