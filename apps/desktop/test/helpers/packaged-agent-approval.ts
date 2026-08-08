import { execFile, spawn, type ChildProcess } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  createSystemExecutableCodeSignatureInspector,
  readApprovalElectronFuseState
} from "../../src/main/approval-surface-qualification.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const mainWindowTitle = "Novel Studio";
const approvalWindowTitles = ["Confirm change set", "Review change set", "审阅变更集"] as const;
const approvalButtonNames = ["Approve change set", "批准变更集"] as const;
const nativeConfirmationTitles = ["Final confirmation required", "需要最终确认"] as const;

export interface PackagedAgentApplication {
  readonly process: ChildProcess;
  readonly processId: number;
  close(): Promise<void>;
}

/** Starts only the supplied signed/asar packaged executable; no Electron/CDP test launcher exists here. */
export async function launchPackagedAgentApplication(
  env: NodeJS.ProcessEnv
): Promise<PackagedAgentApplication> {
  const executablePath = await resolvePackagedExecutable();
  const process = spawn(executablePath, [], { env, stdio: "ignore", windowsHide: true });
  const processId = process.pid;
  if (processId === undefined) {
    process.kill();
    throw new Error("Qualified packaged Agent executable did not expose a process ID.");
  }
  await waitForWindow(processId, mainWindowTitle);
  return {
    process,
    processId,
    async close() {
      if (process.exitCode !== null) return;
      process.kill();
      await new Promise<void>((resolve) => process.once("exit", () => resolve()));
    }
  };
}

export async function configureLocalModelThroughUi(
  application: PackagedAgentApplication,
  baseUrl: string
): Promise<void> {
  await click(application.processId, mainWindowTitle, "设置");
  await setValue(application.processId, mainWindowTitle, "模型 Base URL", baseUrl);
  await setValue(application.processId, mainWindowTitle, "模型名称", "local-agent");
  await setValue(application.processId, mainWindowTitle, "密钥引用", "local-e2e-key");
  await click(application.processId, mainWindowTitle, "保存模型配置");
  await click(application.processId, mainWindowTitle, "测试连接");
  await waitForControl(application, "关闭设置");
  await click(application.processId, mainWindowTitle, "关闭设置");
}

export async function selectCreativeProjectFilesContextThroughUi(
  application: PackagedAgentApplication
): Promise<void> {
  await click(application.processId, mainWindowTitle, "项目文件");
  await waitForControl(application, "项目文件列表");
}

export async function expandCreativeProjectDirectoryThroughUi(
  application: PackagedAgentApplication,
  name: string
): Promise<void> {
  await click(application.processId, mainWindowTitle, `展开目录：${name}`);
}

export async function openCreativeProjectFileThroughUi(
  application: PackagedAgentApplication,
  name: string
): Promise<void> {
  await click(application.processId, mainWindowTitle, `打开文件：${name}`);
  await waitForControl(application, "普通文件正文");
}

export async function controlExistsThroughUi(
  application: PackagedAgentApplication,
  name: string
): Promise<boolean> {
  return (
    (await invokeUiAutomation("exists", application.processId, mainWindowTitle, name)) === "true"
  );
}

export async function readControlTextThroughUi(
  application: PackagedAgentApplication,
  name: string
): Promise<string> {
  const encoded = await invokeUiAutomation(
    "read-text",
    application.processId,
    mainWindowTitle,
    name
  );
  return Buffer.from(encoded, "base64").toString("utf8");
}

export async function startAgentRunThroughUi(
  application: PackagedAgentApplication,
  request: string
): Promise<void> {
  await clickIfPresent(application.processId, mainWindowTitle, "新建会话");
  await clickIfPresent(application.processId, mainWindowTitle, "选择计划或执行模式");
  await clickIfPresent(application.processId, mainWindowTitle, "执行");
  await setValue(application.processId, mainWindowTitle, "Agent 请求", request);
  await click(application.processId, mainWindowTitle, "启动 Agent 运行");
}

/** First-use sharing is deliberately saved in the visible workbench, then a new run is started. */
export async function saveFirstUseSharingAndRestartRun(
  application: PackagedAgentApplication,
  request: string
): Promise<void> {
  await waitForControl(application, "保存并刷新 Agent");
  await click(application.processId, mainWindowTitle, "保存并刷新 Agent");
  await waitForControl(application, "返回 Agent 重试");
  await click(application.processId, mainWindowTitle, "返回 Agent 重试");
  await startAgentRunThroughUi(application, request);
}

/** Drives the isolated BrowserWindow and the actual Windows native message box through UI Automation. */
export async function approveChangeSetThroughTrustedUi(
  application: PackagedAgentApplication
): Promise<void> {
  await click(application.processId, mainWindowTitle, "应用所选");
  await waitForWindow(application.processId, approvalWindowTitles);
  await waitForControl(application, approvalButtonNames, approvalWindowTitles);
  await click(application.processId, approvalWindowTitles, approvalButtonNames);
  await waitForWindow(application.processId, nativeConfirmationTitles);
  await click(application.processId, nativeConfirmationTitles, approvalButtonNames);
}

export async function undoAgentRunThroughUi(application: PackagedAgentApplication): Promise<void> {
  await click(application.processId, mainWindowTitle, "撤销本次运行");
}

export async function waitForControl(
  application: PackagedAgentApplication,
  name: string | readonly string[],
  windowTitle: string | readonly string[] = mainWindowTitle
): Promise<void> {
  await invokeUiAutomation("wait-control", application.processId, windowTitle, name);
}

async function click(
  processId: number,
  windowTitle: string | readonly string[],
  name: string | readonly string[]
): Promise<void> {
  await invokeUiAutomation("click", processId, windowTitle, name);
}

async function clickIfPresent(processId: number, windowTitle: string, name: string): Promise<void> {
  const present = await invokeUiAutomation("exists", processId, windowTitle, name);
  if (present === "true") await click(processId, windowTitle, name);
}

async function setValue(
  processId: number,
  windowTitle: string,
  name: string,
  value: string
): Promise<void> {
  await invokeUiAutomation("set-value", processId, windowTitle, name, value);
}

async function waitForWindow(processId: number, title: string | readonly string[]): Promise<void> {
  await invokeUiAutomation("wait-window", processId, title);
}

async function resolvePackagedExecutable(): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Packaged Agent approval E2E requires Windows.");
  }
  const configured = process.env["NOVEL_STUDIO_QUALIFIED_PACKAGE_EXE"]?.trim();
  if (configured === undefined || configured.length === 0) {
    throw new Error(
      "NOVEL_STUDIO_QUALIFIED_PACKAGE_EXE must name the qualified packaged executable for Agent E2E."
    );
  }
  const executable = await resolveQualifiedPackagedExecutable(configured);
  await verifyPackagedApprovalQualification(executable);
  return executable;
}

/**
 * Deliberately runs before the process is spawned: these E2E tests are
 * evidence for a release package, never a source-built or unsigned Electron
 * binary. The signature/fuse probes are the exact production implementations;
 * the verifier owns the pinned Security Architecture Owner trust store.
 */
export async function resolveQualifiedPackagedExecutable(configured: string): Promise<string> {
  const requestedExecutable = resolve(configured);
  const packageDirectory = dirname(requestedExecutable);
  const resourcesDirectory = join(packageDirectory, "resources");
  const appAsar = join(resourcesDirectory, "app.asar");

  if (requestedExecutable !== join(packageDirectory, "Novel Studio.exe")) {
    throw new Error("Qualified packaged Agent E2E requires the package's Novel Studio.exe.");
  }
  if (!(await isRegularContainedDirectory(packageDirectory, packageDirectory))) {
    throw new Error("Qualified packaged Agent E2E package directory is not a regular directory.");
  }
  if (!(await isRegularContainedFile(packageDirectory, requestedExecutable))) {
    throw new Error("Qualified packaged Agent E2E executable is missing or is not a regular file.");
  }
  if (!(await isPortableExecutable(requestedExecutable))) {
    throw new Error("Qualified packaged Agent E2E executable is not a valid Windows executable.");
  }
  const signature =
    await createSystemExecutableCodeSignatureInspector().verify(requestedExecutable);
  if (signature !== "valid") {
    throw new Error(
      "Qualified packaged Agent E2E executable must have a valid Authenticode signature."
    );
  }
  if (!(await isRegularContainedDirectory(packageDirectory, resourcesDirectory))) {
    throw new Error(
      "Qualified packaged Agent E2E package is missing a regular resources directory."
    );
  }
  if (!(await isRegularContainedFile(packageDirectory, appAsar))) {
    throw new Error("Qualified packaged Agent E2E package is missing resources/app.asar.");
  }
  if (!(await hasExpectedAsarPackageMetadata(appAsar))) {
    throw new Error("Qualified packaged Agent E2E app.asar has unexpected package metadata.");
  }

  const fuses = await readApprovalElectronFuseState(requestedExecutable);
  if (
    fuses === undefined ||
    !fuses.embeddedAsarIntegrityValidationEnabled ||
    !fuses.onlyLoadAppFromAsarEnabled
  ) {
    throw new Error(
      "Qualified packaged Agent E2E executable is missing required Electron ASAR fuses."
    );
  }
  return requestedExecutable;
}

async function verifyPackagedApprovalQualification(executable: string): Promise<void> {
  const publicKeyFile = process.env["NOVEL_STUDIO_SECURITY_OWNER_ED25519_PUBLIC_KEY_PATH"];
  const publicKeyEnv = process.env["NOVEL_STUDIO_SECURITY_OWNER_ED25519_PUBLIC_KEY_ENV"];
  if ((publicKeyFile === undefined) === (publicKeyEnv === undefined)) {
    throw new Error(
      "Qualified packaged Agent E2E requires exactly one external Security Owner Ed25519 public key input."
    );
  }
  const verifierArguments = [
    "scripts/verify-approval-surface-qualification.mjs",
    "--app-asar",
    join(dirname(executable), "resources", "app.asar")
  ];
  const report = process.env["NOVEL_STUDIO_APPROVAL_QUALIFICATION_REPORT"];
  if (report !== undefined && report.length > 0) verifierArguments.push("--report", report);
  if (publicKeyFile !== undefined && publicKeyFile.length > 0) {
    verifierArguments.push("--public-key-file", publicKeyFile);
  } else if (publicKeyEnv !== undefined && publicKeyEnv.length > 0) {
    verifierArguments.push("--public-key-env", publicKeyEnv);
  } else {
    throw new Error("Qualified packaged Agent E2E Security Owner public key input is empty.");
  }
  const verified = await new Promise<boolean>((resolveVerification) => {
    const verifier = spawn(process.execPath, verifierArguments, {
      cwd: resolve(import.meta.dirname, "../../../../"),
      env: process.env,
      stdio: "ignore",
      windowsHide: true
    });
    verifier.once("error", () => resolveVerification(false));
    verifier.once("exit", (code) => resolveVerification(code === 0));
  });
  if (!verified) {
    throw new Error(
      "Qualified packaged Agent E2E app.asar failed the pinned Security Owner qualification verification."
    );
  }
}

async function hasExpectedAsarPackageMetadata(asarPath: string): Promise<boolean> {
  try {
    const { extractFile, listPackage } = require("@electron/asar") as {
      extractFile(archive: string, filename: string): Buffer;
      listPackage(archive: string): string[];
    };
    const packageEntry = listPackage(asarPath).find(
      (entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "") === "package.json"
    );
    if (packageEntry === undefined) return false;
    const metadata = JSON.parse(extractFile(asarPath, packageEntry).toString("utf8")) as unknown;
    return (
      typeof metadata === "object" &&
      metadata !== null &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).main === "apps/desktop/dist/main/index.js"
    );
  } catch {
    return false;
  }
}

async function isRegularContainedFile(base: string, candidate: string): Promise<boolean> {
  try {
    const [metadata, canonicalBase, canonicalCandidate] = await Promise.all([
      lstat(candidate),
      realpath(base),
      realpath(candidate)
    ]);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      isContainedPath(canonicalBase, canonicalCandidate)
    );
  } catch {
    return false;
  }
}

async function isRegularContainedDirectory(base: string, candidate: string): Promise<boolean> {
  try {
    const [metadata, canonicalBase, canonicalCandidate] = await Promise.all([
      lstat(candidate),
      realpath(base),
      realpath(candidate)
    ]);
    return (
      metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      isContainedPath(canonicalBase, canonicalCandidate)
    );
  } catch {
    return false;
  }
}

function isContainedPath(base: string, candidate: string): boolean {
  const relativePath = relative(base, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..");
}

async function isPortableExecutable(path: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    const peOffset = bytes.readUInt32LE(0x3c);
    return (
      bytes.length >= 0x40 &&
      bytes[0] === 0x4d &&
      bytes[1] === 0x5a &&
      peOffset >= 0x40 &&
      peOffset + 4 <= bytes.length &&
      bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\0\0"))
    );
  } catch {
    return false;
  }
}

async function invokeUiAutomation(
  action: "click" | "exists" | "read-text" | "set-value" | "wait-control" | "wait-window",
  processId: number,
  windowTitle: string | readonly string[],
  name?: string | readonly string[],
  value?: string
): Promise<string> {
  const encoded = Buffer.from(
    JSON.stringify({
      action,
      processId,
      windowTitles: Array.isArray(windowTitle) ? windowTitle : [windowTitle],
      controlNames: name === undefined ? [] : Array.isArray(name) ? name : [name],
      value: value ?? ""
    }),
    "utf8"
  ).toString("base64");
  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$input = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$deadline = [DateTime]::UtcNow.AddSeconds(30)
function Find-NameCondition([string[]]$names) {
  $nameConditions = [System.Windows.Automation.Condition[]]@($names | ForEach-Object {
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $_)
  })
  if ($nameConditions.Length -eq 1) { return $nameConditions[0] }
  return [System.Windows.Automation.OrCondition]::new($nameConditions)
}
function Find-Window([string[]]$titles) {
  $nameCondition = Find-NameCondition $titles
  $processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$input.processId)
  $conditions = [System.Windows.Automation.Condition[]]@($nameCondition, $processCondition)
  $condition = [System.Windows.Automation.AndCondition]::new($conditions)
  return [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
}
function Find-Control($window, [string[]]$controlNames) {
  $condition = Find-NameCondition $controlNames
  return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Read-ControlText($control) {
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    return ([System.Windows.Automation.ValuePattern]$pattern).Current.Value
  }
  $pattern = $null
  if ($control.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    return ([System.Windows.Automation.TextPattern]$pattern).DocumentRange.GetText(-1)
  }
  $descendants = $control.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($descendant in $descendants) {
    $pattern = $null
    if ($descendant.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      return ([System.Windows.Automation.ValuePattern]$pattern).Current.Value
    }
  }
  $bestText = $null
  foreach ($descendant in $descendants) {
    $pattern = $null
    if ($descendant.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
      $candidate = ([System.Windows.Automation.TextPattern]$pattern).DocumentRange.GetText(-1)
      if ($null -eq $bestText -or $candidate.Length -gt $bestText.Length) { $bestText = $candidate }
    }
  }
  return $bestText
}
while ([DateTime]::UtcNow -lt $deadline) {
  $window = Find-Window $input.windowTitles
  if ($input.action -eq 'wait-window' -and $null -ne $window) { 'true'; exit 0 }
  if ($null -ne $window) {
    $control = Find-Control $window $input.controlNames
    if ($input.action -eq 'exists') { if ($null -ne $control) { 'true' } else { 'false' }; exit 0 }
    if ($input.action -eq 'wait-control' -and $null -ne $control) { 'true'; exit 0 }
    if ($input.action -eq 'read-text' -and $null -ne $control) {
      $text = Read-ControlText $control
      if ($null -eq $text) { throw "Control '$($input.controlNames -join '|')' has no readable text pattern." }
      [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$text)); exit 0
    }
    if ($input.action -eq 'click' -and $null -ne $control) {
      $pattern = $null
      if ($control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        ([System.Windows.Automation.InvokePattern]$pattern).Invoke(); 'true'; exit 0
      }
      throw "Control '$($input.controlNames -join '|')' is not invokable."
    }
    if ($input.action -eq 'set-value' -and $null -ne $control) {
      $pattern = $null
      if ($control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        ([System.Windows.Automation.ValuePattern]$pattern).SetValue($input.value); 'true'; exit 0
      }
      throw "Control '$($input.controlNames -join '|')' does not support ValuePattern."
    }
  }
  Start-Sleep -Milliseconds 100
}
if ($input.action -eq 'exists') { 'false'; exit 0 }
throw "Timed out waiting for '$($input.controlNames -join '|')' in '$($input.windowTitles -join '|')'."
`;
  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      windowsHide: true,
      timeout: 35_000
    }
  );
  return result.stdout.trim();
}
