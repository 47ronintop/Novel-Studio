import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const root = process.cwd();
const dist = join(root, "native", "engineering-file-access-win32", "dist", "win32-x64");
const paths = {
  addon: join(dist, "engineering_file_access.node"),
  manifest: join(dist, "engineering_file_access.manifest.json"),
  signature: join(dist, "engineering_file_access.manifest.p7s")
};
const reportPath =
  process.env.ENGINEERING_FILE_ACCESS_PROBE_REPORT ??
  join(dist, "engineering_file_access.probe.json");
const protections = [
  "rootRelativeTraversal",
  "noFollowTraversal",
  "rawByteIdentity",
  "receiptBinding",
  "durability",
  "recoveryRootBinding"
];
const controls = [
  "rootRelativeDisabled",
  "noFollowDisabled",
  "rawByteIdentityDisabled",
  "receiptBindingDisabled",
  "durabilityDisabled",
  "recoveryRootBindingDisabled"
];
await Promise.all([stat(paths.addon), stat(paths.manifest)]);
const signaturePresent = await stat(paths.signature)
  .then(() => true)
  .catch(() => false);
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const [addonSha, manifestSha] = await Promise.all([digest(paths.addon), digest(paths.manifest)]);
const signatureSha = signaturePresent ? await digest(paths.signature) : null;
const manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
if (
  manifest.target !== "win32-x64" ||
  manifest.adapterId !== "novel_studio_engineering_file_access" ||
  manifest.nodeApiVersion !== 8 ||
  manifest.artifact?.sha256 !== addonSha
) {
  throw new Error("native manifest or addon digest mismatch");
}

const verification = await verifyProductionEvidence();
if (!verification.production) {
  assertUnsignedDevelopmentArtifact(manifest, signaturePresent);
  const info = require(paths.addon).adapterInfo();
  if (
    info.target !== "win32-x64" ||
    info.batch !== "6" ||
    info.accessEligible !== "unavailable" ||
    info.mutation !== "unavailable" ||
    info.recovery !== "unavailable"
  ) {
    throw new Error("development addon does not preserve the Batch 6 capability boundary");
  }
  await writeFile(
    reportPath,
    `${JSON.stringify({ schemaVersion: "development-1.0", adapterId: manifest.adapterId, target: manifest.target, packageKind: "development", productionQualified: false, capabilities: { root: "unavailable", access: "unavailable", read: "unavailable", index: "unavailable", mutation: "unavailable", recovery: "unavailable" }, reason: verification.reason, artifactSha256: addonSha, artifactManifestSha256: manifestSha, artifactManifestSignatureSha256: signatureSha }, null, 2)}\n`,
    "utf8"
  );
  console.log(
    JSON.stringify({ reportPath, productionQualified: false, reason: verification.reason })
  );
  process.exit(0);
}

const evidencePath = process.env.ENGINEERING_FILE_ACCESS_PROBE_EVIDENCE;
if (!evidencePath)
  throw new Error(
    "Production probe requires ENGINEERING_FILE_ACCESS_PROBE_EVIDENCE from the actual package protection and fault runner"
  );
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
if (
  !hasExactMap(evidence.positiveProtections, protections, "passed") ||
  !hasExactMap(evidence.negativeControls, controls, "canary_exposed")
) {
  throw new Error(
    "Production probe evidence did not prove every positive protection and disabled-protection canary"
  );
}
const now = new Date();
const report = {
  schemaVersion: "1.0",
  adapterId: "novel_studio_engineering_file_access",
  target: "win32-x64",
  packageKind: "production",
  artifactSha256: addonSha,
  artifactManifestSha256: manifestSha,
  artifactManifestSignatureSha256: signatureSha,
  artifactSignatureVerification: "trusted_publisher",
  manifestSignatureVerification: "trusted_publisher",
  digestVerification: "match",
  publisherPolicyChecksum: manifest.publisherPolicyChecksum,
  generatedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  positiveProtections: evidence.positiveProtections,
  negativeControls: evidence.negativeControls
};
report.reportChecksum = sha256(stable(report));
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ reportPath, productionQualified: true, artifactSha256: addonSha }));

async function verifyProductionEvidence() {
  if (!signaturePresent) {
    return { production: false, reason: "unsigned_or_untrusted_development_artifact" };
  }
  if (
    process.platform !== "win32" ||
    !process.env.CMS_TRUST_STORE ||
    manifest.signing?.authenticode !== "trusted_publisher" ||
    manifest.signing?.detachedCms !== "trusted_publisher"
  ) {
    return { production: false, reason: "unsigned_or_untrusted_development_artifact" };
  }
  const command =
    "if ((Get-AuthenticodeSignature -LiteralPath $env:ENGINEERING_FILE_ACCESS_ADDON).Status -ne 'Valid') { exit 1 }";
  try {
    await run("powershell.exe", ["-NoProfile", "-Command", command], {
      env: { ...process.env, ENGINEERING_FILE_ACCESS_ADDON: paths.addon }
    });
    await run("openssl", [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-in",
      paths.signature,
      "-content",
      paths.manifest,
      "-CAfile",
      process.env.CMS_TRUST_STORE,
      "-purpose",
      "any",
      "-out",
      "NUL"
    ]);
    return { production: true };
  } catch {
    return { production: false, reason: "signature_or_trust_verification_failed" };
  }
}

function hasExactMap(value, keys, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => value[key] === expected)
  );
}

function assertUnsignedDevelopmentArtifact(manifest, signaturePresent) {
  if (
    signaturePresent ||
    manifest.signing?.authenticode !== "required-for-production" ||
    manifest.signing?.detachedCms !== "required-for-production" ||
    manifest.signing?.developmentUnsigned !== true ||
    manifest.qualification?.productionQualified !== false ||
    manifest.eligibility?.batch !== "6" ||
    manifest.eligibility?.mutation !== "unavailable" ||
    manifest.eligibility?.recovery !== "unavailable"
  ) {
    throw new Error("development probe requires an unsigned Batch 6-only artifact");
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
