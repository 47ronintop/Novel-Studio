import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const verifierOptionNames = new Set(["--report", "--public-key-file", "--public-key-env"]);
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const runId = createRunId();
const outputDirectory = `release/installer-${runId}`;
const unpackedDirectory = `${outputDirectory}/win-unpacked`;

await mkdir(join(root, "release"), { recursive: true });

if (!options.skipBuild) {
  await run("npm", ["run", "build"]);
}
await run("node", ["scripts/release-check.mjs"]);
if (options.qualified) {
  await run("node", [
    "scripts/verify-approval-surface-qualification.mjs",
    ...options.verifierArguments
  ]);
}
await run("node", ["scripts/release-notes.mjs"]);
await run(
  "electron-builder",
  ["--win", "nsis", "dir", "--config", "apps/desktop/electron-builder.config.cjs"],
  {
    NOVEL_STUDIO_PACKAGE_OUTPUT: outputDirectory
  }
);
await run("node", ["scripts/artifact-secret-scan.mjs", unpackedDirectory]);
await run(
  "node",
  ["scripts/release-check.mjs", "--strict", "--package-dir", unpackedDirectory],
  options.releaseEnvironment
);

const installerPath = await findInstaller(outputDirectory);
await writeFile(join(root, "release", "latest-package-dir.txt"), `${unpackedDirectory}\n`, "utf8");
await writeFile(join(root, "release", "latest-installer.txt"), `${installerPath}\n`, "utf8");

console.log(`Installer ready: ${installerPath}`);

function parseArguments(argumentsList) {
  let skipBuild = false;
  let qualified = false;
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--skip-build") {
      if (skipBuild) throw new Error("Duplicate package-installer argument: --skip-build.");
      skipBuild = true;
      continue;
    }
    if (argument === "--qualified") {
      if (qualified) throw new Error("Duplicate package-installer argument: --qualified.");
      qualified = true;
      continue;
    }
    if (!verifierOptionNames.has(argument)) {
      throw new Error(`Unsupported package-installer argument: ${argument ?? ""}`);
    }
    const value = argumentsList[index + 1];
    if (value === undefined || values.has(argument)) {
      throw new Error(`Invalid package-installer verifier argument: ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }
  if (!qualified && values.size > 0) {
    throw new Error("Qualification verifier arguments require --qualified.");
  }
  if (qualified && !skipBuild) {
    throw new Error(
      "Qualified package-installer requires a previously signed clean build: use --qualified --skip-build."
    );
  }
  if (qualified && values.has("--public-key-file") === values.has("--public-key-env")) {
    throw new Error(
      "Qualified package-installer requires exactly one external Security Owner public key input."
    );
  }
  const verifierArguments = [];
  const report = values.get("--report");
  if (report !== undefined) verifierArguments.push("--report", report);
  for (const name of ["--public-key-file", "--public-key-env"]) {
    const value = values.get(name);
    if (value !== undefined) verifierArguments.push(name, value);
  }
  const releaseEnvironment = {};
  if (qualified) {
    if (report !== undefined)
      releaseEnvironment.NOVEL_STUDIO_APPROVAL_QUALIFICATION_REPORT = report;
    const publicKeyFile = values.get("--public-key-file");
    const publicKeyEnv = values.get("--public-key-env");
    if (publicKeyFile !== undefined) {
      releaseEnvironment.NOVEL_STUDIO_SECURITY_OWNER_ED25519_PUBLIC_KEY_PATH = publicKeyFile;
    }
    if (publicKeyEnv !== undefined) {
      releaseEnvironment.NOVEL_STUDIO_SECURITY_OWNER_ED25519_PUBLIC_KEY_ENV = publicKeyEnv;
    }
  }
  return { skipBuild, qualified, verifierArguments, releaseEnvironment };
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

async function findInstaller(outputDirectoryPath) {
  const entries = await readdir(join(root, outputDirectoryPath), { withFileTypes: true });
  const installer = entries.find((entry) => entry.isFile() && entry.name.endsWith(".exe"));

  if (installer === undefined) {
    throw new Error(`No NSIS installer was produced in ${outputDirectoryPath}`);
  }

  return `${outputDirectoryPath}/${installer.name}`;
}
