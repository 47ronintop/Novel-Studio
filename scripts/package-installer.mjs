import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const runId = createRunId();
const outputDirectory = `release/installer-${runId}`;
const unpackedDirectory = `${outputDirectory}/win-unpacked`;

await mkdir(join(root, "release"), { recursive: true });

await run("npm", ["run", "build"]);
await run("node", ["scripts/release-check.mjs"]);
await run("node", ["scripts/release-notes.mjs"]);
await run(
  "electron-builder",
  ["--win", "nsis", "dir", "--config", "apps/desktop/electron-builder.config.cjs"],
  {
    NOVEL_STUDIO_PACKAGE_OUTPUT: outputDirectory
  }
);
await run("node", ["scripts/artifact-secret-scan.mjs", unpackedDirectory]);

const installerPath = await findInstaller(outputDirectory);
await writeFile(join(root, "release", "latest-package-dir.txt"), `${unpackedDirectory}\n`, "utf8");
await writeFile(join(root, "release", "latest-installer.txt"), `${installerPath}\n`, "utf8");

console.log(`Installer ready: ${installerPath}`);

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

async function findInstaller(outputDirectoryPath) {
  const entries = await readdir(join(root, outputDirectoryPath), { withFileTypes: true });
  const installer = entries.find((entry) => entry.isFile() && entry.name.endsWith(".exe"));

  if (installer === undefined) {
    throw new Error(`No NSIS installer was produced in ${outputDirectoryPath}`);
  }

  return `${outputDirectoryPath}/${installer.name}`;
}
