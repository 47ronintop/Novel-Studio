import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);
const root = process.cwd();
const buildDisabledProtectionCanaries = process.argv.includes("--disabled-protection-canaries");
if (process.argv.slice(2).some((argument) => argument !== "--disabled-protection-canaries")) {
  throw new Error("unsupported build argument");
}
const disabledProtectionCanaryTargets = [
  "engineering_file_access_root_relative_disabled",
  "engineering_file_access_no_follow_disabled",
  "engineering_file_access_raw_byte_identity_disabled",
  "engineering_file_access_receipt_binding_disabled",
  "engineering_file_access_durability_disabled",
  "engineering_file_access_recovery_root_binding_disabled"
];
const mutationFaultInjectionTarget = "engineering_file_access_mutation_fault_injection";
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("engineering-file-access-win32 only supports win32-x64 CI builds");
}

const vsDevCmd = process.env.ENGINEERING_FILE_ACCESS_VSDEVCMD;
const generator = process.env.ENGINEERING_FILE_ACCESS_CMAKE_GENERATOR;
const cmakeMakeProgram = process.env.CMAKE_MAKE_PROGRAM;
if (!vsDevCmd || !generator || !cmakeMakeProgram) {
  throw new Error(
    "the CI-discovered Visual Studio environment, CMake generator, and make program are required"
  );
}
if (generator !== "Ninja") {
  throw new Error(`unsupported CI CMake generator: ${generator}`);
}
for (const [label, path] of [
  ["ENGINEERING_FILE_ACCESS_VSDEVCMD", vsDevCmd],
  ["CMAKE_MAKE_PROGRAM", cmakeMakeProgram]
]) {
  try {
    await stat(path);
  } catch {
    throw new Error(`${label} must point to a CI-provided executable`);
  }
}

const toolchainEnvironment = { ...process.env };
const vsEnvironment = await run(
  "cmd.exe",
  ["/d", "/c", `call "${vsDevCmd}" -no_logo -host_arch=x64 -arch=x64 >nul && set`],
  {
    cwd: root,
    env: toolchainEnvironment,
    maxBuffer: 1024 * 1024,
    windowsVerbatimArguments: true
  }
);
for (const line of vsEnvironment.stdout.split(/\r?\n/u)) {
  const separator = line.indexOf("=");
  if (separator > 0) {
    toolchainEnvironment[line.slice(0, separator)] = line.slice(separator + 1);
  }
}
if (!toolchainEnvironment.VCToolsVersion || !toolchainEnvironment.VCToolsInstallDir) {
  throw new Error("VsDevCmd did not expose a Visual Studio C++ toolchain");
}
const compilerPath = (
  await run("where.exe", ["cl.exe"], { cwd: root, env: toolchainEnvironment })
).stdout
  .split(/\r?\n/u)
  .find(Boolean);
if (!compilerPath) throw new Error("VsDevCmd did not expose cl.exe");

const sourceRevision = (
  process.env.SOURCE_REVISION ?? (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout
).trim();
const nativeSourceFiles = [
  "native/engineering-file-access-win32/CMakeLists.txt",
  "native/engineering-file-access-win32/src/engineering_file_access.cc"
];
const sourceFiles = await Promise.all(
  nativeSourceFiles.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(join(root, path)))
      .digest("hex")
  }))
);
const sourceIdentity = {
  revision: sourceRevision,
  files: sourceFiles,
  sha256: sha256(stable({ revision: sourceRevision, files: sourceFiles }))
};
const includeDir = process.env.NODE_API_INCLUDE_DIR;
if (!includeDir)
  throw new Error("NODE_API_INCLUDE_DIR must point to the CI-provided Node-API headers");
const nodeLibrary = process.env.NODE_LIBRARY ?? join(process.execPath, "..", "node.lib");
try {
  await stat(nodeLibrary);
} catch {
  throw new Error("NODE_LIBRARY must point to the CI-provided Node-API import library");
}
const cmakeCapabilities = JSON.parse(
  (await run("cmake", ["-E", "capabilities"], { cwd: root, env: toolchainEnvironment })).stdout
);
if (!cmakeCapabilities.generators?.some(({ name }) => name === generator)) {
  throw new Error(`the installed CMake does not support the ${generator} generator`);
}
const cmakeVersion = (
  await run("cmake", ["--version"], { cwd: root, env: toolchainEnvironment })
).stdout
  .split(/\r?\n/u)[0]
  .trim();
const toolchain = {
  cmakeVersion,
  generator,
  architecture: "x64",
  nodeVersion: process.version,
  visualStudioVersion: process.env.ENGINEERING_FILE_ACCESS_VS_VERSION ?? null,
  vcToolsVersion: toolchainEnvironment.VCToolsVersion,
  compilerPath
};
const toolchainIdentity = {
  sha256: sha256(stable(toolchain))
};
const buildIdentity = {
  sha256: sha256(
    stable({
      target: "win32-x64",
      nodeApiVersion: 8,
      sourceIdentitySha256: sourceIdentity.sha256,
      toolchainIdentitySha256: toolchainIdentity.sha256
    })
  )
};
const buildDir = join(
  root,
  "native",
  "engineering-file-access-win32",
  ".build",
  buildDisabledProtectionCanaries ? "disabled-protection-canaries-win32-x64" : "win32-x64"
);
const distDir = join(root, "native", "engineering-file-access-win32", "dist", "win32-x64");
if (!buildDisabledProtectionCanaries) {
  await mkdir(distDir, { recursive: true });
  // A normal build produces an unsigned development artifact. A stale release signature must
  // never make that artifact appear packageable or production-qualified.
  await Promise.all([
    rm(join(distDir, "engineering_file_access.manifest.p7s"), { force: true }),
    rm(join(distDir, "engineering_file_access.probe.json"), { force: true }),
    rm(join(distDir, "engineering_file_access.sha256"), { force: true })
  ]);
}
await run(
  "cmake",
  [
    "-S",
    "native/engineering-file-access-win32",
    "-B",
    buildDir,
    "-G",
    generator,
    `-DCMAKE_MAKE_PROGRAM=${cmakeMakeProgram}`,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DNODE_API_INCLUDE_DIR=${includeDir}`,
    `-DNODE_LIBRARY=${nodeLibrary}`,
    `-DENGINEERING_BUILD_DISABLED_PROTECTION_CANARIES=${buildDisabledProtectionCanaries ? "ON" : "OFF"}`
  ],
  { cwd: root, env: toolchainEnvironment }
);
const buildTargets = buildDisabledProtectionCanaries
  ? ["engineering_file_access", ...disabledProtectionCanaryTargets, mutationFaultInjectionTarget]
  : ["engineering_file_access"];
await run("cmake", ["--build", buildDir, "--target", ...buildTargets], {
  cwd: root,
  env: toolchainEnvironment
});
if (buildDisabledProtectionCanaries) {
  for (const target of buildTargets) {
    const candidates = [
      join(buildDir, "Release", `${target}.node`),
      join(buildDir, `${target}.node`)
    ];
    let found = false;
    for (const candidate of candidates) {
      try {
        await stat(candidate);
        found = true;
        break;
      } catch (error) {
        if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
      }
    }
    if (!found) throw new Error(`CMake did not produce ${target}.node`);
  }
  const identity = {
    schemaVersion: "engineering_file_access_canary_build_identity_v1",
    target: "win32-x64",
    nodeApiVersion: 8,
    sourceRevision,
    sourceIdentity,
    toolchain: {
      ...toolchain,
      ...toolchainIdentity
    },
    buildIdentity,
    buildTargets
  };
  const sidecar = {
    ...identity,
    identityChecksum: sha256(stable(identity))
  };
  await writeFile(
    join(buildDir, "engineering_file_access.canary-build-identity.json"),
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8"
  );
  console.log(`Built disabled-protection canaries in ${buildDir}`);
} else {
  const candidates = [
    join(buildDir, "Release", "engineering_file_access.node"),
    join(buildDir, "engineering_file_access.node")
  ];
  let source;
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      source = candidate;
      break;
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
    }
  }
  if (!source) throw new Error("CMake did not produce engineering_file_access.node");
  const artifact = await readFile(source);
  const artifactPath = join(distDir, "engineering_file_access.node");
  await writeFile(artifactPath, artifact);
  const manifest = {
    schemaVersion: "1.0",
    adapterId: "novel_studio_engineering_file_access",
    target: "win32-x64",
    sourceRevision,
    nodeApiVersion: 8,
    sourceIdentity,
    toolchain: {
      ...toolchain,
      ...toolchainIdentity
    },
    buildIdentity,
    publisherPolicyChecksum: process.env.PUBLISHER_POLICY_CHECKSUM ?? null,
    artifact: {
      path: "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
      sha256: createHash("sha256").update(artifact).digest("hex")
    },
    eligibility: {
      batch: "6",
      // These describe the development ABI that CI must probe. They are not production
      // qualification: the separate qualification block remains fail-closed until a signed,
      // packaged artifact and its evidence have been verified by Main.
      access: "available",
      root: "available",
      read: "available",
      index: "available",
      mutation: "unavailable",
      recovery: "unavailable"
    },
    developmentMutationV2Probe: {
      schemaVersion: "1.1",
      batch: "8",
      sourceIdentitySha256: sourceIdentity.sha256,
      toolchainIdentitySha256: toolchainIdentity.sha256,
      primitives: {
        rawByteBlobs: "available",
        absenceProof: "available",
        absenceProofV2: "available",
        objectMutationAbi: "available",
        targetInspection: "available",
        operationStateReconciliation: "available",
        handleRelativeRevalidation: "available",
        finalRenameNamespaceRevalidation: "available",
        hardLinkPolicy: "reject_multiple_links",
        copyOnReplace: "not_enabled",
        fixedCreateMetadata: "available",
        receiptDurability: "available",
        stagingWalRecoveryScan: "available",
        faultProbe: "available",
        stateDurability: "available"
      },
      lifecyclePrimitives: {
        move: "available",
        caseOnlyTwoStepWal: "available",
        volumeLocalRecoveryRoot: "available",
        quarantineDelete: "available",
        restoreNoOverwrite: "available",
        localPurge: "available",
        singleLevelCreateDirectory: "available"
      },
      productCapability: "unavailable"
    },
    signing: {
      authenticode: "required-for-production",
      detachedCms: "required-for-production",
      developmentUnsigned: true
    },
    qualification: {
      productionQualified: false,
      eligibleCapabilities: [],
      unavailableCapabilities: ["root", "access", "read", "index", "mutation", "recovery"]
    }
  };
  await writeFile(
    join(distDir, "engineering_file_access.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  console.log(`Built ${artifactPath}`);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
