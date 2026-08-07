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
document.signing = { authenticode: "trusted_publisher", detachedCms: "trusted_publisher" };
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
