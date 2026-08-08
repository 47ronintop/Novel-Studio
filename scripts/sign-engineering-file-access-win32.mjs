import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);
const root = process.cwd();
const dist = join(root, "native", "engineering-file-access-win32", "dist", "win32-x64");
const addon = join(dist, "engineering_file_access.node");
const manifest = join(dist, "engineering_file_access.manifest.json");
const signature = join(dist, "engineering_file_access.manifest.p7s");
const publisherPolicyChecksum = process.env.PUBLISHER_POLICY_CHECKSUM;
const probeEvidencePath = process.env.ENGINEERING_FILE_ACCESS_PROBE_EVIDENCE;
await stat(addon);
await stat(manifest);
if (
  !process.env.SIGN_CERT_PFX ||
  !process.env.SIGN_CERT_PASSWORD ||
  !process.env.CMS_SIGNING_CERT ||
  !process.env.CMS_SIGNING_KEY
) {
  throw new Error(
    "Production signing requires SIGN_CERT_PFX, SIGN_CERT_PASSWORD, CMS_SIGNING_CERT and CMS_SIGNING_KEY"
  );
}
if (publisherPolicyChecksum === undefined || !/^[0-9a-f]{64}$/iu.test(publisherPolicyChecksum)) {
  throw new Error("Production signing requires a 64-hex PUBLISHER_POLICY_CHECKSUM");
}
if (probeEvidencePath === undefined || probeEvidencePath.length === 0) {
  throw new Error("Production signing requires ENGINEERING_FILE_ACCESS_PROBE_EVIDENCE");
}
let probeEvidence;
try {
  probeEvidence = JSON.parse(await readFile(probeEvidencePath, "utf8"));
} catch {
  throw new Error("Production signing requires readable native positive/negative probe evidence");
}
if (!hasProductionProbeEvidence(probeEvidence)) {
  throw new Error(
    "Production signing requires every native protection and disabled-protection canary"
  );
}
const signtool = (await run("where.exe", ["signtool.exe"])).stdout.trim().split(/\r?\n/u)[0];
await run(signtool, [
  "sign",
  "/fd",
  "SHA256",
  "/f",
  process.env.SIGN_CERT_PFX,
  "/p",
  process.env.SIGN_CERT_PASSWORD,
  "/tr",
  "http://timestamp.digicert.com",
  "/td",
  "SHA256",
  addon
]);
const document = JSON.parse(await readFile(manifest, "utf8"));
document.artifact.sha256 = createHash("sha256")
  .update(await readFile(addon))
  .digest("hex");
document.publisherPolicyChecksum = publisherPolicyChecksum.toLowerCase();
document.signing = { authenticode: "trusted_publisher", detachedCms: "trusted_publisher" };
document.eligibility = {
  batch: "6",
  root: "available",
  access: "available",
  read: "available",
  index: "available",
  mutation: "unavailable",
  recovery: "unavailable"
};
document.qualification = {
  productionQualified: true,
  eligibleCapabilities: ["root", "access", "read", "index"],
  unavailableCapabilities: ["mutation", "recovery"],
  // This input is release-pipeline evidence only. CMS signs the enclosing manifest; Main compares
  // the signer pins and recomputes a fresh installed-addon observation before using it.
  probeEvidence: {
    positiveProtections: probeEvidence.positiveProtections,
    negativeControls: probeEvidence.negativeControls
  }
};
await writeFile(manifest, `${JSON.stringify(document, null, 2)}\n`, "utf8");
await run("openssl", [
  "cms",
  "-sign",
  "-binary",
  "-in",
  manifest,
  "-signer",
  process.env.CMS_SIGNING_CERT,
  "-inkey",
  process.env.CMS_SIGNING_KEY,
  "-outform",
  "DER",
  "-out",
  signature
]);
const digest = (path) =>
  readFile(path).then((bytes) => createHash("sha256").update(bytes).digest("hex"));
const hashes = {
  addon: await digest(addon),
  manifest: await digest(manifest),
  signature: await digest(signature)
};
console.log(`Signed engineering native artifacts: ${JSON.stringify(hashes)}`);

function hasProductionProbeEvidence(value) {
  return (
    value &&
    typeof value === "object" &&
    hasExactMap(
      value.positiveProtections,
      [
        "rootRelativeTraversal",
        "noFollowTraversal",
        "rawByteIdentity",
        "receiptBinding",
        "durability",
        "recoveryRootBinding"
      ],
      "passed"
    ) &&
    hasExactMap(
      value.negativeControls,
      [
        "rootRelativeDisabled",
        "noFollowDisabled",
        "rawByteIdentityDisabled",
        "receiptBindingDisabled",
        "durabilityDisabled",
        "recoveryRootBindingDisabled"
      ],
      "canary_exposed"
    )
  );
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
