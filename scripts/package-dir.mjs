import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const verifierOptionNames = new Set(["--report", "--public-key-file", "--public-key-env"]);
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const skipBuild = options.skipBuild;
const runId = createRunId();
const outputDirectory = `release/package-dir-${runId}`;
const unpackedDirectory = `${outputDirectory}/win-unpacked`;

await mkdir(join(root, "release"), { recursive: true });

if (!skipBuild) {
  await run("npm", ["run", "build"]);
}
if (options.qualified) {
  await run("node", [
    "scripts/verify-approval-surface-qualification.mjs",
    ...options.verifierArguments
  ]);
}
await run("electron-builder", ["--dir", "--config", "apps/desktop/electron-builder.config.cjs"], {
  NOVEL_STUDIO_PACKAGE_OUTPUT: outputDirectory
});
await run("node", ["scripts/artifact-secret-scan.mjs", unpackedDirectory]);
await writeFile(join(root, "release", "latest-package-dir.txt"), `${unpackedDirectory}\n`, "utf8");

console.log(`Package directory ready: ${unpackedDirectory}`);

function parseArguments(argumentsList) {
  let skipBuild = false;
  let qualified = false;
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--skip-build") {
      if (skipBuild) throw new Error("Duplicate package-dir argument: --skip-build.");
      skipBuild = true;
      continue;
    }
    if (argument === "--qualified") {
      if (qualified) throw new Error("Duplicate package-dir argument: --qualified.");
      qualified = true;
      continue;
    }
    if (!verifierOptionNames.has(argument)) {
      throw new Error(`Unsupported package-dir argument: ${argument ?? ""}`);
    }
    const value = argumentsList[index + 1];
    if (value === undefined || values.has(argument)) {
      throw new Error(`Invalid package-dir verifier argument: ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }
  if (!qualified && values.size > 0) {
    throw new Error("Qualification verifier arguments require --qualified.");
  }
  if (qualified && !skipBuild) {
    throw new Error(
      "Qualified package-dir requires a previously signed clean build: use --qualified --skip-build."
    );
  }
  if (qualified && values.has("--public-key-file") === values.has("--public-key-env")) {
    throw new Error(
      "Qualified package-dir requires exactly one external Security Owner public key input."
    );
  }
  const verifierArguments = [];
  const report = values.get("--report");
  if (report !== undefined) verifierArguments.push("--report", report);
  for (const name of ["--public-key-file", "--public-key-env"]) {
    const value = values.get(name);
    if (value !== undefined) verifierArguments.push(name, value);
  }
  return { skipBuild, qualified, verifierArguments };
}

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
