/* global document, URL, location, navigator, window */

const byId = (id) => document.getElementById(id);
const title = byId("title");
const summary = byId("summary");
const details = byId("details");
const status = byId("status");
const approve = byId("approve");
const cancel = byId("cancel");
const previewId = new URL(location.href).hash.slice(1);
let payload;
let decisionInFlight = false;

const messages = {
  en: {
    approve: "Approve change set",
    approvalActions: "Approval actions",
    cancel: "Cancel",
    canceling: "Cancelling approval…",
    canonicalDetails: "Canonical details",
    changeSet: "Change set",
    closing: "Approval dismissed. Closing this confirmation window…",
    closingSafely: "Approval could not be dismissed here. Closing safely…",
    completed: "Approval completed. Closing this confirmation window…",
    diff: "Canonical diff",
    displayChecksum: "Display checksum",
    dismissed: "Approval was dismissed or not completed. Close this window and try again.",
    finalConfirmation: "Waiting for final native confirmation…",
    loading: "Loading Main-owned approval details…",
    operation: "Operation",
    recovery: "Recovery side effect",
    review: "Review change set",
    reviewBeforeApproving: "Review the canonical change set before approving.",
    selectedOperations: "Selected operations",
    summary: "Workspace: {workspace} · Revision: {revision}",
    unavailable: "This approval preview is unavailable.",
    notCompleted: "Approval was not completed. Close this window and try again.",
    kind: "Kind",
    pathRole: "{role}: {path}",
    operationSummary: "Summary"
  },
  "zh-CN": {
    approve: "批准变更集",
    approvalActions: "审批操作",
    cancel: "取消",
    canceling: "正在取消审批…",
    canonicalDetails: "规范详情",
    changeSet: "变更集",
    closing: "审批已取消，正在关闭确认窗口…",
    closingSafely: "无法在此取消审批，正在安全关闭…",
    completed: "审批已完成，正在关闭确认窗口…",
    diff: "规范差异",
    displayChecksum: "显示校验和",
    dismissed: "审批已取消或未完成。请关闭此窗口后重试。",
    finalConfirmation: "正在等待原生最终确认…",
    loading: "正在加载由 Main 控制的审批详情…",
    operation: "操作",
    recovery: "恢复副作用",
    review: "审阅变更集",
    reviewBeforeApproving: "请先审阅规范变更集，再批准。",
    selectedOperations: "已选择的操作",
    summary: "工作区：{workspace} · 修订版：{revision}",
    unavailable: "此审批预览不可用。",
    notCompleted: "审批未完成。请关闭此窗口后重试。",
    kind: "类别",
    pathRole: "{role}：{path}",
    operationSummary: "摘要"
  }
};

const locale = navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
const message = (key, replacements = {}) =>
  Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    messages[locale][key]
  );

function configureLocale() {
  document.documentElement.lang = locale;
  document.title = message("review");
  title.textContent = message("review");
  summary.textContent = message("loading");
  byId("details-heading").textContent = message("canonicalDetails");
  details.setAttribute("aria-label", message("canonicalDetails"));
  status.textContent = "";
  byId("actions").setAttribute("aria-label", message("approvalActions"));
  cancel.textContent = message("cancel");
  approve.textContent = message("approve");
}

const setStatus = (text, isError) => {
  status.textContent = text;
  status.className = isError ? "error" : "muted";
};
const string = (value) => (typeof value === "string" ? value : "");

function render(safe) {
  const operations = Array.isArray(safe.selectedOperations) ? safe.selectedOperations : [];
  const renderedOperations = operations.map((operation) => {
    const paths = Array.isArray(operation && operation.paths) ? operation.paths : [];
    const renderedPaths = paths.map(
      (path) =>
        `  ${message("pathRole", {
          role: string(path && path.role),
          path: string(path && path.path)
        })}`
    );
    return [
      `${message("operation")}: ${string(operation && operation.operationId)}`,
      `${message("kind")}: ${string(operation && operation.operationKind)}`,
      ...renderedPaths,
      `${message("operationSummary")}: ${string(operation && operation.summary)}`
    ].join("\n");
  });
  title.textContent = `${message("review")}: ${string(safe.changeSetId)}`;
  summary.textContent = message("summary", {
    workspace: string(safe.workspaceLabel),
    revision: String(safe.changeSetRevision ?? "")
  });
  details.textContent = [
    `${message("changeSet")}: ${string(safe.changeSetId)}`,
    `${message("displayChecksum")}: ${string(safe.displayChecksum)}`,
    `${message("selectedOperations")}:\n${renderedOperations.join("\n\n")}`,
    `${message("diff")}:\n${string(safe.canonicalDiff)}`,
    `${message("recovery")}:\n${string(safe.recoverySideEffect)}`
  ].join("\n\n");
}

async function cancelApproval() {
  if (decisionInFlight) return;
  decisionInFlight = true;
  approve.disabled = true;
  cancel.disabled = true;
  setStatus(message("canceling"), false);
  try {
    if (payload) {
      const result = await window.novelStudioApproval.decide({
        previewId: payload.previewId,
        modalInstanceId: payload.modalInstanceId,
        nonce: payload.nonce,
        decision: "cancel"
      });
      setStatus(
        result && result.ok ? message("closing") : message("closingSafely"),
        !(result && result.ok)
      );
    }
  } catch {
    // Closing the Main-created modal revokes its preview, so an IPC failure must not leave a
    // clickable stale confirmation behind.
    setStatus(message("closingSafely"), true);
  } finally {
    window.close();
  }
}

cancel.addEventListener("click", () => void cancelApproval());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void cancelApproval();
  }
});
approve.addEventListener("click", async () => {
  if (!payload || decisionInFlight) return;
  decisionInFlight = true;
  approve.disabled = true;
  cancel.disabled = true;
  setStatus(message("finalConfirmation"), false);
  try {
    const result = await window.novelStudioApproval.decide({
      previewId: payload.previewId,
      modalInstanceId: payload.modalInstanceId,
      nonce: payload.nonce,
      decision: "approve"
    });
    if (result && result.ok && result.value && result.value.status === "approved") {
      setStatus(message("completed"), false);
      window.close();
      return;
    }
    setStatus(message("dismissed"), true);
  } catch {
    setStatus(message("notCompleted"), true);
  }
  decisionInFlight = false;
  cancel.disabled = false;
});

void window.novelStudioApproval
  .getPreview(previewId)
  .then((result) => {
    if (!result || !result.ok || !result.value || !result.value.display) {
      setStatus(message("unavailable"), true);
      return;
    }
    payload = result.value;
    render(payload.display);
    approve.disabled = false;
    setStatus(message("reviewBeforeApproving"), false);
  })
  .catch(() => setStatus(message("unavailable"), true));

configureLocale();
cancel.focus();
