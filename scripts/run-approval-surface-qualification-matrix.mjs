import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1,
  APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH,
  createQualificationReport,
  loadCleanApprovalBuild
} from "./approval-surface-qualification-common.mjs";

const qualificationMatrixGroups = Object.freeze([
  {
    cases: ["renderer_forgery_rejected"],
    files: ["apps/desktop/test/agent-approval-confirmation.test.ts"]
  },
  {
    cases: ["binding_replay_rejected"],
    files: ["packages/agent-engine/test/approval-binding-v2.test.ts"]
  },
  {
    cases: [
      "modal_navigation_and_injection_rejected",
      "untrusted_content_rendered_as_plain_text",
      "window_focus_default_and_cancel_contract",
      "accessibility_and_localization_contract"
    ],
    files: ["apps/desktop/test/trusted-approval-modal-window.test.ts"]
  },
  {
    cases: ["crash_and_restart_revoke_evidence"],
    files: ["apps/desktop/test/approval-parent-window-lifecycle.test.ts"]
  },
  {
    cases: ["unsigned_digest_or_qualification_drift_closes_surface"],
    files: ["apps/desktop/test/approval-surface-qualification.test.ts"]
  },
  {
    cases: ["limited_run_preapproval_policy_exclusions"],
    files: [
      "packages/agent-engine/test/approval-binding-v2.test.ts",
      "packages/agent-engine/test/permission-summary.test.ts",
      "packages/agent-engine/test/approval-decision-proof.test.ts",
      "apps/desktop/test/agent-feature-flags.test.ts"
    ]
  }
]);
if (
  qualificationMatrixGroups.flatMap((group) => group.cases).join("\n") !==
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.cases.join("\n")
) {
  throw new Error("Qualification matrix runner cases must match the fixed ADR-0004 matrix.");
}

const root = process.cwd();
const reportPath = parseReportPath(process.argv.slice(2));
const build = await loadCleanApprovalBuild(root);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const cases = [];

for (const group of qualificationMatrixGroups) {
  const passed = await run(npmCommand, [
    "exec",
    "vitest",
    "--",
    "run",
    ...group.files,
    "--no-file-parallelism"
  ]);
  for (const id of group.cases) {
    cases.push({ id, status: passed ? "passed" : "failed" });
  }
}

const report = createQualificationReport(build, cases);
const destination = resolve(root, reportPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Approval qualification matrix report written: ${reportPath}`);

if (cases.some((entry) => entry.status !== "passed")) {
  process.exitCode = 1;
}

function parseReportPath(argumentsList) {
  if (argumentsList.length === 0) return APPROVAL_SURFACE_QUALIFICATION_REPORT_PATH;
  if (argumentsList.length !== 2 || argumentsList[0] !== "--report") {
    throw new Error(
      "Usage: node scripts/run-approval-surface-qualification-matrix.mjs [--report release/...]"
    );
  }
  const candidate = argumentsList[1];
  if (candidate === undefined || isAbsolute(candidate) || !isInsideRelease(candidate)) {
    throw new Error("Qualification matrix reports must be written beneath release/.");
  }
  return candidate;
}

function isInsideRelease(candidate) {
  const resolved = resolve(root, candidate);
  const releaseRoot = resolve(root, "release");
  const pathRelative = relative(releaseRoot, resolved);
  return pathRelative !== "" && !pathRelative.startsWith("..") && !isAbsolute(pathRelative);
}

function run(command, argumentsList) {
  return new Promise((resolveRun) => {
    const child = spawn(command, argumentsList, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", () => resolveRun(false));
    child.once("exit", (code) => resolveRun(code === 0));
  });
}
