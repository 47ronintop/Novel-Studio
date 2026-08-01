import type { ChangeSetApproval } from "@novel-studio/agent-engine";

const trustedSafeAutoApprovals = new WeakSet<object>();

export function authorizeStoryAnalysisSafeAutoApproval<T extends ChangeSetApproval>(
  approval: T
): T {
  if (approval.approvalSource === "project_safe_auto_update") {
    trustedSafeAutoApprovals.add(approval);
  }
  return approval;
}

export function consumeStoryAnalysisSafeAutoApproval(approval: object): boolean {
  const authorized = trustedSafeAutoApprovals.has(approval);
  trustedSafeAutoApprovals.delete(approval);
  return authorized;
}
