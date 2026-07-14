const trustedPreapprovedProposalInputs = new WeakSet<object>();
const trustedPreapprovedApprovals = new WeakSet<object>();

export function authorizeAgentRunProposal<T extends object>(input: T): T {
  trustedPreapprovedProposalInputs.add(input);
  return input;
}

export function consumeAgentRunProposalAuthorization(input: object): boolean {
  const authorized = trustedPreapprovedProposalInputs.has(input);
  trustedPreapprovedProposalInputs.delete(input);
  return authorized;
}

export function revokeAgentRunProposalAuthorization(input: object): void {
  trustedPreapprovedProposalInputs.delete(input);
}

export function authorizeAgentRunApproval<T extends object>(approval: T): T {
  trustedPreapprovedApprovals.add(approval);
  return approval;
}

export function consumeAgentRunApprovalAuthorization(approval: object): boolean {
  const authorized = trustedPreapprovedApprovals.has(approval);
  trustedPreapprovedApprovals.delete(approval);
  return authorized;
}

export function revokeAgentRunApprovalAuthorization(approval: object): void {
  trustedPreapprovedApprovals.delete(approval);
}
