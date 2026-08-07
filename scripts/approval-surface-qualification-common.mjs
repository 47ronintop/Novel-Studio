import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH =
  "apps/desktop/dist/approval/approval-surface-qualification-v1.json";
export const APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH =
  "apps/desktop/dist/approval/approval-surface-qualification-v1.sig";
export const APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH =
  "release/qualification/approval-surface-qualification-matrix-v1.json";
export const APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1 = Object.freeze({
  schemaVersion: "1.0",
  revision: "adr-0004-qualification-r1",
  cases: Object.freeze([
    "renderer_forgery_rejected",
    "binding_replay_rejected",
    "modal_navigation_and_injection_rejected",
    "untrusted_content_rendered_as_plain_text",
    "window_focus_default_and_cancel_contract",
    "accessibility_and_localization_contract",
    "crash_and_restart_revoke_evidence",
    "unsigned_digest_or_qualification_drift_closes_surface",
    "limited_run_preapproval_policy_exclusions"
  ])
});
export const REQUIRED_APPROVAL_ARTIFACTS = Object.freeze({
  approvalHtml: "apps/desktop/dist/approval/index.html",
  approvalJs: "apps/desktop/dist/approval/approval.js",
  approvalCss: "apps/desktop/dist/approval/approval.css",
  approvalPreload: "apps/desktop/dist/preload/approval-preload.cjs"
});
export const APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM = sha256(
  canonicalJsonBytes(APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1)
);
/**
 * Production owner identities are source-pinned and must change with the Main
 * process trust store in a reviewed source change. Empty is intentional until
 * Security Architecture supplies that pin; release verification then closes.
 */
export const PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS = Object.freeze({});

const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^[a-f0-9]{40}$/u;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function canonicalJsonBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("APPROVAL_QUALIFICATION_CANONICAL_JSON_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("APPROVAL_QUALIFICATION_CANONICAL_JSON_INVALID");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function loadCleanApprovalBuild(root) {
  const manifestPath = join(root, "apps", "desktop", "dist", "build-manifest.json");
  const manifest = await readJson(manifestPath, "Build manifest");
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== "1.0" ||
    manifest.sourceDirty !== false ||
    !isSourceRevision(manifest.sourceRevision) ||
    !isRecord(manifest.artifacts)
  ) {
    throw new Error("A clean build manifest is required for approval-surface qualification.");
  }

  const rows = [];
  for (const [name, relativePath] of Object.entries(REQUIRED_APPROVAL_ARTIFACTS)) {
    const artifact = manifest.artifacts[name];
    if (
      !isRecord(artifact) ||
      artifact.path !== relativePath ||
      artifact.sourceRevision !== manifest.sourceRevision ||
      !isHash(artifact.sha256)
    ) {
      throw new Error(`Build manifest does not bind approval artifact: ${name}.`);
    }
    const bytes = await readFile(resolve(root, relativePath));
    if (sha256(bytes) !== artifact.sha256) {
      throw new Error(`Approval artifact digest drift: ${relativePath}.`);
    }
    rows.push(`${relativePath}\n${artifact.sha256}`);
  }

  return Object.freeze({
    manifest,
    sourceRevision: manifest.sourceRevision,
    approvalBundleDigest: sha256(Buffer.from(rows.sort().join("\n"), "utf8")),
    approvalArtifactManifestChecksum: sha256(canonicalJsonBytes(manifest.artifacts))
  });
}

export async function loadValidatedQualificationReport(root, reportPath, build) {
  const report = await readJson(resolve(root, reportPath), "Qualification matrix report");
  if (
    !isRecord(report) ||
    !hasExactKeys(report, qualificationReportKeys) ||
    report.schemaVersion !== "1.0" ||
    report.kind !== "approval_surface_qualification_matrix_report" ||
    report.sourceRevision !== build.sourceRevision ||
    report.approvalBundleDigest !== build.approvalBundleDigest ||
    report.qualificationMatrixRevision !== APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.revision ||
    report.qualificationMatrixChecksum !== APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM ||
    !isCanonicalUtcTimestamp(report.generatedAt) ||
    !isExactPassedCases(report.cases)
  ) {
    throw new Error(
      "Qualification matrix report is invalid, incomplete, or does not bind this build."
    );
  }
  return Object.freeze({ report, checksum: sha256(canonicalJsonBytes(report)) });
}

export function createQualificationReport(build, cases, generatedAt = new Date().toISOString()) {
  if (!isCanonicalUtcTimestamp(generatedAt)) {
    throw new Error("Qualification report timestamp must use canonical UTC milliseconds.");
  }
  const report = {
    schemaVersion: "1.0",
    kind: "approval_surface_qualification_matrix_report",
    sourceRevision: build.sourceRevision,
    approvalBundleDigest: build.approvalBundleDigest,
    qualificationMatrixRevision: APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.revision,
    qualificationMatrixChecksum: APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
    generatedAt,
    cases
  };
  if (!isExactReportCaseIds(report.cases)) {
    throw new Error("Qualification report cases must match the fixed ADR-0004 matrix.");
  }
  return report;
}

export function createAttestation(build, report, input) {
  const unsigned = {
    schemaVersion: "1.0",
    authority: "security_architecture_owner",
    qualificationRevision: input.qualificationRevision,
    sourceRevision: build.sourceRevision,
    approvalBundleDigest: build.approvalBundleDigest,
    approvalArtifactManifestChecksum: build.approvalArtifactManifestChecksum,
    qualificationMatrixRevision: APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.revision,
    qualificationMatrixChecksum: APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
    automatedReportChecksum: report.checksum,
    ownerApprovalId: input.ownerApprovalId,
    ownerKeyId: input.ownerKeyId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt
  };
  if (
    !isStableId(unsigned.qualificationRevision) ||
    !isStableId(unsigned.ownerApprovalId) ||
    !isStableId(unsigned.ownerKeyId) ||
    !isCanonicalUtcTimestamp(unsigned.issuedAt) ||
    !isCanonicalUtcTimestamp(unsigned.expiresAt) ||
    Date.parse(unsigned.expiresAt) <= Date.parse(unsigned.issuedAt) ||
    Date.parse(unsigned.expiresAt) - Date.parse(unsigned.issuedAt) > 90 * 24 * 60 * 60 * 1000
  ) {
    throw new Error("Qualification attestation identity or validity fields are invalid.");
  }
  return Object.freeze({
    ...unsigned,
    attestationChecksum: sha256(canonicalJsonBytes(unsigned))
  });
}

export async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} is missing or invalid JSON.`);
  }
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHash(value) {
  return typeof value === "string" && HASH.test(value);
}

export function isSourceRevision(value) {
  return typeof value === "string" && SOURCE_REVISION.test(value);
}

export function isStableId(value) {
  return typeof value === "string" && STABLE_ID.test(value);
}

export function isCanonicalUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    CANONICAL_UTC_TIMESTAMP.test(value) &&
    new Date(value).toISOString() === value
  );
}

export function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}

function isExactPassedCases(cases) {
  return (
    isExactReportCaseIds(cases) &&
    cases.every(
      (entry) => isRecord(entry) && hasExactKeys(entry, reportCaseKeys) && entry.status === "passed"
    )
  );
}

function isExactReportCaseIds(cases) {
  return (
    Array.isArray(cases) &&
    cases.length === APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.cases.length &&
    cases.every(
      (entry, index) =>
        isRecord(entry) && entry.id === APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.cases[index]
    )
  );
}

const qualificationReportKeys = [
  "schemaVersion",
  "kind",
  "sourceRevision",
  "approvalBundleDigest",
  "qualificationMatrixRevision",
  "qualificationMatrixChecksum",
  "generatedAt",
  "cases"
];
const reportCaseKeys = ["id", "status"];
