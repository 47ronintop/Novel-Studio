import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1,
  APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH,
  PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS,
  REQUIRED_ARTIFACTS,
  loadApprovalSurfaceQualification
} from "../src/main/approval-surface-qualification.js";

describe("approval-surface qualification release tools", () => {
  test("uses the fixed ADR-0004 matrix checksum for release evidence", async () => {
    const qualification =
      await import("../../../scripts/approval-surface-qualification-common.mjs");

    expect(qualification.APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1).toEqual({
      schemaVersion: "1.0",
      revision: "adr-0004-qualification-r1",
      cases: [
        "renderer_forgery_rejected",
        "binding_replay_rejected",
        "modal_navigation_and_injection_rejected",
        "untrusted_content_rendered_as_plain_text",
        "window_focus_default_and_cancel_contract",
        "accessibility_and_localization_contract",
        "crash_and_restart_revoke_evidence",
        "unsigned_digest_or_qualification_drift_closes_surface",
        "limited_run_preapproval_policy_exclusions"
      ]
    });
    expect(qualification.APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM).toBe(
      "ff303c07ee58295f1484eff2bd0699a3fa1714d09bb7b5c36d6d1e49ed8b5f57"
    );
    expect(qualification.APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1).toEqual(
      APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1
    );
    expect(qualification.APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM).toBe(
      APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM
    );
    expect(qualification.APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH).toBe(
      APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH
    );
    expect(qualification.APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH).toBe(
      APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH
    );
    expect(qualification.REQUIRED_APPROVAL_ARTIFACTS).toEqual(REQUIRED_ARTIFACTS);
    expect(qualification.PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS).toEqual(
      PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS
    );
  });

  test("requires explicit external owner key input and never generates a signing key", async () => {
    const [signer, verifier] = await Promise.all([
      readFile("scripts/sign-approval-surface-qualification.mjs", "utf8"),
      readFile("scripts/verify-approval-surface-qualification.mjs", "utf8")
    ]);

    expect(signer).toContain("--private-key-file");
    expect(signer).toContain("--private-key-env");
    expect(signer).not.toContain("generateKeyPair");
    expect(verifier).toContain("--public-key-file");
    expect(verifier).toContain("--public-key-env");
    await expect(
      runScript("scripts/sign-approval-surface-qualification.mjs")
    ).resolves.toMatchObject({
      exitCode: 1,
      output: expect.stringContaining(
        "Provide exactly one external Security Owner private key input."
      )
    });
    await expect(
      runScript("scripts/verify-approval-surface-qualification.mjs")
    ).resolves.toMatchObject({
      exitCode: 1,
      output: expect.stringContaining(
        "Provide exactly one external Security Owner public key input."
      )
    });
  });

  test("signs and verifies a clean fixed-matrix report with a temporary external Ed25519 key", async () => {
    const root = await mkdtemp(join(tmpdir(), "approval-qualification-release-tool-"));
    const keyRoot = await mkdtemp(join(tmpdir(), "approval-qualification-owner-key-"));
    try {
      const qualification =
        await import("../../../scripts/approval-surface-qualification-common.mjs");
      const sourceRevision = "a".repeat(40);
      const artifacts: Record<string, { path: string; sha256: string; sourceRevision: string }> =
        {};
      for (const [name, path] of Object.entries(qualification.REQUIRED_APPROVAL_ARTIFACTS)) {
        const absolute = join(root, path);
        await mkdir(join(absolute, ".."), { recursive: true });
        const content = Buffer.from(name, "utf8");
        await writeFile(absolute, content);
        artifacts[name] = {
          path,
          sha256: createHash("sha256").update(content).digest("hex"),
          sourceRevision
        };
      }
      await writeFile(
        join(root, "apps", "desktop", "dist", "build-manifest.json"),
        JSON.stringify({ schemaVersion: "1.0", sourceRevision, sourceDirty: false, artifacts })
      );
      const build = await qualification.loadCleanApprovalBuild(root);
      const report = qualification.createQualificationReport(
        build,
        qualification.APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.cases.map((id: string) => ({
          id,
          status: "passed"
        })),
        "2026-08-06T12:00:00.000Z"
      );
      const reportPath = "release/qualification/report.json";
      await mkdir(join(root, "release", "qualification"), { recursive: true });
      await writeFile(join(root, reportPath), JSON.stringify(report));
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const privateKeyPath = join(keyRoot, "external-owner-private.pem");
      const publicKeyPath = join(keyRoot, "external-owner-public.pem");
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
      const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
      await writeFile(privateKeyPath, privateKeyPem);
      await writeFile(publicKeyPath, publicKeyPem);
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const signed = await runScript(
        "scripts/sign-approval-surface-qualification.mjs",
        [
          "--report",
          reportPath,
          "--private-key-file",
          privateKeyPath,
          "--qualification-revision",
          "adr-0004-approval-surface-r1",
          "--owner-approval-id",
          "security-review-20260806",
          "--owner-key-id",
          "owner-key-test",
          "--issued-at",
          issuedAt,
          "--expires-at",
          expiresAt
        ],
        root
      );
      expect(signed.exitCode, signed.output).toBe(0);
      await expect(
        runScript(
          "scripts/verify-approval-surface-qualification.mjs",
          ["--report", reportPath, "--public-key-file", publicKeyPath],
          root
        )
      ).resolves.toMatchObject({
        exitCode: 1,
        output: expect.stringContaining("is not pinned by the Main-process production trust store")
      });
      const asarPath = join(keyRoot, "qualified-app.asar");
      const { createPackage } = createRequire(import.meta.url)("@electron/asar") as {
        createPackage(source: string, destination: string): Promise<void>;
      };
      await createPackage(root, asarPath);
      const packagedVerification = await runScript(
        "scripts/verify-approval-surface-qualification.mjs",
        ["--report", reportPath, "--public-key-file", publicKeyPath, "--app-asar", asarPath],
        root
      );
      expect(packagedVerification.exitCode).toBe(1);
      expect(packagedVerification.output).toContain(
        "is not pinned by the Main-process production trust store"
      );
      await expect(
        loadApprovalSurfaceQualification({
          rootDirectory: root,
          buildManifestPath: join(root, "apps", "desktop", "dist", "build-manifest.json"),
          mode: "production",
          packageSignatureInspector: { covers: async () => true },
          ownerTrustStore: { "owner-key-test": publicKeyPem },
          now: () => issuedAt
        })
      ).resolves.toMatchObject({ ok: true, value: { status: "qualified" } });
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(keyRoot, { recursive: true, force: true })
      ]);
    }
  });

  test("keeps qualification release-only and requires verification for qualified packaging", async () => {
    const [packageJson, packageDirectory, installer, releaseCheck, workflow] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("scripts/package-dir.mjs", "utf8"),
      readFile("scripts/package-installer.mjs", "utf8"),
      readFile("scripts/release-check.mjs", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8")
    ]);

    expect(packageJson).toContain('"qualification:matrix"');
    expect(packageJson).toContain('"qualification:sign"');
    expect(packageJson).toContain('"qualification:verify"');
    expect(packageDirectory).toContain("--qualified --skip-build");
    expect(installer).toContain("--qualified --skip-build");
    expect(releaseCheck).toContain("verifySecurityOwnerQualification");
    expect(workflow).not.toContain("qualification:sign");
    expect(workflow).not.toContain("NOVEL_STUDIO_SECURITY_OWNER_ED25519_PRIVATE");
  });
});

function runScript(
  path: string,
  args: readonly string[] = [],
  cwd = process.cwd()
): Promise<{ readonly exitCode: number | null; readonly output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), path), ...args], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolveRun({ exitCode, output }));
  });
}
