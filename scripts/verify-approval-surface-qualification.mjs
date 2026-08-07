import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
  APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH,
  APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1,
  PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS,
  canonicalJsonBytes,
  hasExactKeys,
  isCanonicalUtcTimestamp,
  isHash,
  isRecord,
  isStableId,
  loadCleanApprovalBuild,
  loadValidatedQualificationReport,
  readJson,
  sha256
} from "./approval-surface-qualification-common.mjs";

const require = createRequire(import.meta.url);
const argumentNames = new Set(["--report", "--public-key-file", "--public-key-env", "--app-asar"]);
const attestationKeys = [
  "schemaVersion",
  "authority",
  "qualificationRevision",
  "sourceRevision",
  "approvalBundleDigest",
  "approvalArtifactManifestChecksum",
  "qualificationMatrixRevision",
  "qualificationMatrixChecksum",
  "automatedReportChecksum",
  "ownerApprovalId",
  "ownerKeyId",
  "issuedAt",
  "expiresAt",
  "attestationChecksum"
];
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const extractedRoot =
  options.appAsar === undefined ? undefined : await extractQualificationInputs(options.appAsar);
const qualificationRoot = extractedRoot ?? root;

try {
  const build = await loadCleanApprovalBuild(qualificationRoot);
  const report = await loadValidatedQualificationReport(root, options.reportPath, build);
  const attestation = await readJson(
    resolve(qualificationRoot, APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH),
    "Security Owner qualification attestation"
  );
  const signature = await readFile(
    resolve(qualificationRoot, APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH)
  );
  const publicKey = await createOwnerPublicKey(options);

  if (!isValidAttestation(attestation, build, report.checksum)) {
    throw new Error(
      "Security Owner qualification attestation is invalid or does not bind this build/report."
    );
  }
  requirePinnedOwnerKey(attestation.ownerKeyId, publicKey);
  if (
    signature.length !== 64 ||
    !verify(null, canonicalJsonBytes(attestation), publicKey, signature)
  ) {
    throw new Error("Security Owner qualification signature is invalid.");
  }
  console.log("Security Owner qualification attestation verified.");
} finally {
  if (extractedRoot !== undefined) {
    await rm(extractedRoot, { recursive: true, force: true });
  }
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (name === undefined || value === undefined || !argumentNames.has(name) || values.has(name)) {
      throw new Error("Invalid qualification verifier arguments.");
    }
    values.set(name, value);
  }
  const publicKeyFile = values.get("--public-key-file");
  const publicKeyEnv = values.get("--public-key-env");
  if ((publicKeyFile === undefined) === (publicKeyEnv === undefined)) {
    throw new Error("Provide exactly one external Security Owner public key input.");
  }
  return {
    reportPath: values.get("--report") ?? APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH,
    publicKeyFile,
    publicKeyEnv,
    appAsar: values.get("--app-asar")
  };
}

async function createOwnerPublicKey(options) {
  const keyMaterial =
    options.publicKeyFile !== undefined
      ? await readOwnerKeyFile(options.publicKeyFile)
      : readOwnerKeyEnvironment(options.publicKeyEnv);
  let publicKey;
  try {
    publicKey = createPublicKey(keyMaterial);
  } catch {
    throw new Error("Security Owner public key input is not a valid public key.");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Security Owner qualification verification requires an Ed25519 public key.");
  }
  return publicKey;
}

async function readOwnerKeyFile(path) {
  return readFile(isAbsolute(path) ? path : resolve(root, path));
}

function readOwnerKeyEnvironment(name) {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(name)) {
    throw new Error("Security Owner public-key environment variable name is invalid.");
  }
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error("Security Owner public-key environment variable is unavailable.");
  }
  return value;
}

function isValidAttestation(attestation, build, reportChecksum) {
  if (!hasExactKeys(attestation, attestationKeys) || !isRecord(attestation)) return false;
  if (
    attestation.schemaVersion !== "1.0" ||
    attestation.authority !== "security_architecture_owner" ||
    !isStableId(attestation.qualificationRevision) ||
    attestation.sourceRevision !== build.sourceRevision ||
    attestation.approvalBundleDigest !== build.approvalBundleDigest ||
    attestation.approvalArtifactManifestChecksum !== build.approvalArtifactManifestChecksum ||
    attestation.qualificationMatrixRevision !== APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.revision ||
    attestation.qualificationMatrixChecksum !== APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM ||
    attestation.automatedReportChecksum !== reportChecksum ||
    !isStableId(attestation.ownerApprovalId) ||
    !isStableId(attestation.ownerKeyId) ||
    !isCanonicalUtcTimestamp(attestation.issuedAt) ||
    !isCanonicalUtcTimestamp(attestation.expiresAt) ||
    !isHash(attestation.attestationChecksum)
  ) {
    return false;
  }
  const unsigned = Object.fromEntries(
    Object.entries(attestation).filter(([key]) => key !== "attestationChecksum")
  );
  const issuedAt = Date.parse(attestation.issuedAt);
  const expiresAt = Date.parse(attestation.expiresAt);
  const now = Date.now();
  return (
    attestation.attestationChecksum === sha256(canonicalJsonBytes(unsigned)) &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= 90 * 24 * 60 * 60 * 1000 &&
    issuedAt <= now &&
    now < expiresAt
  );
}

function requirePinnedOwnerKey(ownerKeyId, suppliedPublicKey) {
  const pinned = PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS[ownerKeyId];
  if (typeof pinned !== "string" || pinned.length === 0) {
    throw new Error(
      "Security Owner key ID is not pinned by the Main-process production trust store."
    );
  }
  let pinnedPublicKey;
  try {
    pinnedPublicKey = createPublicKey(pinned);
  } catch {
    throw new Error("Main-process production owner trust store contains an invalid Ed25519 key.");
  }
  const expected = pinnedPublicKey.export({ type: "spki", format: "der" });
  const supplied = suppliedPublicKey.export({ type: "spki", format: "der" });
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error(
      "External Security Owner public key does not match the Main-process pinned key."
    );
  }
}

async function extractQualificationInputs(appAsar) {
  const archivePath = resolve(root, appAsar);
  const metadata = await lstat(archivePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Packaged qualification verification requires a regular app.asar file.");
  }
  const requiredEntries = [
    "apps/desktop/dist/build-manifest.json",
    "apps/desktop/dist/approval/index.html",
    "apps/desktop/dist/approval/approval.js",
    "apps/desktop/dist/approval/approval.css",
    "apps/desktop/dist/preload/approval-preload.cjs",
    APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
    APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH
  ];
  const rootDirectory = await mkdtemp(join(tmpdir(), "novel-studio-qualified-asar-"));
  try {
    const { extractFile, listPackage, statFile } = require("@electron/asar");
    const entries = new Map(
      listPackage(archivePath).map((entry) => [
        entry.replace(/\\/g, "/").replace(/^\/+/, ""),
        entry
      ])
    );
    for (const path of requiredEntries) {
      const archiveEntry = entries.get(path);
      if (archiveEntry === undefined) {
        throw new Error(`Packaged qualification input is missing app.asar entry: ${path}.`);
      }
      const filesystemEntry = path.replace(/\//g, "\\");
      const entry = statFile(archivePath, filesystemEntry, false);
      if (!("offset" in entry) || entry.unpacked === true || "link" in entry || "files" in entry) {
        throw new Error(`Packaged qualification input is not a regular packed file: ${path}.`);
      }
      const destination = resolve(rootDirectory, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, extractFile(archivePath, filesystemEntry, false));
    }
    return rootDirectory;
  } catch (error) {
    await rm(rootDirectory, { recursive: true, force: true });
    throw error;
  }
}
