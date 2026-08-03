import { randomBytes } from "node:crypto";

const trustedPreapprovedProposalInputs = new WeakSet<object>();
const trustedPreapprovedApprovals = new WeakSet<object>();
const trustedMainApprovalIssuers = new WeakSet<object>();
const trustedApprovalBindingV2 = new WeakSet<object>();

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

/**
 * Main-owned provenance for Approval Binding 2.0. The issuer object is kept
 * in Main memory and is never accepted from renderer IPC or provider data.
 */
export function createMainApprovalIssuer(): object {
  const issuer = Object.freeze({ issuerId: randomBytes(24).toString("base64url") });
  trustedMainApprovalIssuers.add(issuer);
  return issuer;
}

export function authorizeApprovalBindingV2<T extends object>(input: T, issuer: object): T {
  if (!trustedMainApprovalIssuers.has(issuer)) {
    throw new Error("Only the Main approval coordinator can issue an Approval Binding 2.0.");
  }
  trustedApprovalBindingV2.add(input);
  return input;
}

export function consumeApprovalBindingV2Authorization(input: object): boolean {
  const authorized = trustedApprovalBindingV2.has(input);
  trustedApprovalBindingV2.delete(input);
  return authorized;
}

export function hasApprovalBindingV2Authorization(input: object): boolean {
  return trustedApprovalBindingV2.has(input);
}

export function revokeApprovalBindingV2Authorization(input: object): void {
  trustedApprovalBindingV2.delete(input);
}

/** Opaque in-process capability for Main-to-repository calls. */
export function mintMainOwnedCapability(issuer: object): string {
  if (!trustedMainApprovalIssuers.has(issuer)) {
    throw new Error("Only the Main approval coordinator can mint an authorization capability.");
  }
  return randomBytes(32).toString("base64url");
}
