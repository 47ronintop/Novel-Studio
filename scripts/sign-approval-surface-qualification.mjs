import { createPrivateKey, sign } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
  APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH,
  APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH,
  canonicalJsonBytes,
  createAttestation,
  loadCleanApprovalBuild,
  loadValidatedQualificationReport
} from "./approval-surface-qualification-common.mjs";

const argumentNames = new Set([
  "--report",
  "--private-key-file",
  "--private-key-env",
  "--qualification-revision",
  "--owner-approval-id",
  "--owner-key-id",
  "--issued-at",
  "--expires-at"
]);
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const build = await loadCleanApprovalBuild(root);
const report = await loadValidatedQualificationReport(root, options.reportPath, build);
const privateKey = await createOwnerPrivateKey(options);
const attestation = createAttestation(build, report, options);
const signature = sign(null, canonicalJsonBytes(attestation), privateKey);

if (signature.length !== 64) {
  throw new Error(
    "Security Owner qualification signature must be a 64-byte Ed25519 detached signature."
  );
}

const attestationPath = resolve(root, APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH);
const signaturePath = resolve(root, APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH);
await mkdir(dirname(attestationPath), { recursive: true });
await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
await writeFile(signaturePath, signature);
console.log(
  `Security Owner qualification attestation written: ${APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH}`
);

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || value === undefined || !argumentNames.has(name) || values.has(name)) {
      throw new Error("Invalid qualification signer arguments.");
    }
    values.set(name, value);
  }
  const privateKeyFile = values.get("--private-key-file");
  const privateKeyEnv = values.get("--private-key-env");
  if ((privateKeyFile === undefined) === (privateKeyEnv === undefined)) {
    throw new Error("Provide exactly one external Security Owner private key input.");
  }
  const required = [
    "--qualification-revision",
    "--owner-approval-id",
    "--owner-key-id",
    "--issued-at",
    "--expires-at"
  ];
  for (const name of required) {
    if (!values.has(name))
      throw new Error(`Missing required qualification signer argument: ${name}.`);
  }
  return {
    reportPath: values.get("--report") ?? APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH,
    privateKeyFile,
    privateKeyEnv,
    qualificationRevision: values.get("--qualification-revision"),
    ownerApprovalId: values.get("--owner-approval-id"),
    ownerKeyId: values.get("--owner-key-id"),
    issuedAt: values.get("--issued-at"),
    expiresAt: values.get("--expires-at")
  };
}

async function createOwnerPrivateKey(options) {
  const keyMaterial =
    options.privateKeyFile !== undefined
      ? await readOwnerKeyFile(options.privateKeyFile)
      : readOwnerKeyEnvironment(options.privateKeyEnv);
  let privateKey;
  try {
    privateKey = createPrivateKey(keyMaterial);
  } catch {
    throw new Error("Security Owner private key input is not a valid private key.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Security Owner qualification signing requires an Ed25519 private key.");
  }
  return privateKey;
}

async function readOwnerKeyFile(path) {
  if (!isAbsolute(path)) {
    throw new Error(
      "Security Owner private key file must be an absolute path outside the workspace."
    );
  }
  const [workspace, metadata] = await Promise.all([realpath(root), lstat(path)]);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Security Owner private key file must be a regular non-symlink file.");
  }
  const canonical = await realpath(path);
  if (isContainedPath(workspace, canonical)) {
    throw new Error("Security Owner private key file must be outside the workspace.");
  }
  return readFile(canonical);
}

function isContainedPath(base, candidate) {
  const pathRelative = relative(base, candidate);
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function readOwnerKeyEnvironment(name) {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(name)) {
    throw new Error("Security Owner private-key environment variable name is invalid.");
  }
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error("Security Owner private-key environment variable is unavailable.");
  }
  return value;
}
