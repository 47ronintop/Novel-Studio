import {
  canonicalLeafNameCollisionKey,
  validateCanonicalLeafName,
  type CanonicalLeafName
} from "./canonical-leaf-name.js";

export type EngineeringPathClassification =
  "hard_denied" | "policy_managed" | "ignored_generated" | "ordinary";

export type EngineeringPathRejectCode =
  | "invalid_type"
  | "empty"
  | "absolute_or_namespace"
  | "non_canonical_relative_identity"
  | "invalid_segment";

export type EngineeringRelativePathValidation =
  | {
      readonly ok: true;
      readonly relativeIdentity: string;
      readonly segments: readonly CanonicalLeafName[];
    }
  | { readonly ok: false; readonly code: EngineeringPathRejectCode };

export type EngineeringPathClassificationResult =
  | {
      readonly ok: true;
      readonly relativeIdentity: string;
      readonly classification: EngineeringPathClassification;
    }
  | { readonly ok: false; readonly code: EngineeringPathRejectCode };

export interface EngineeringPathPolicyInput {
  /** Exact, Main-owned relative identities excluded by the current ignore policy. */
  readonly ignoredRelativeIdentities?: readonly string[];
  /** Main-owned ignored roots, such as product build outputs. */
  readonly ignoredRootNames?: readonly string[];
  /** Additional exact leaf names whose edits require an explicit policy path. */
  readonly policyManagedLeafNames?: readonly string[];
}

export interface EngineeringPathPolicy {
  readonly ignoredRelativeIdentityKeys: ReadonlySet<string>;
  readonly ignoredRootKeys: ReadonlySet<string>;
  readonly policyManagedLeafKeys: ReadonlySet<string>;
}

export type EngineeringPathPolicyCreation =
  | { readonly ok: true; readonly value: EngineeringPathPolicy }
  | { readonly ok: false; readonly code: "invalid_policy" };

const HARD_DENIED_NAMESPACE_KEYS = new Set(
  [
    ".git",
    ".novel-studio",
    ".novel-studio-state",
    ".novel-studio-journal",
    ".novel-studio-recovery",
    ".novel-studio-quarantine",
    ".novel-studio-history"
  ].map(toCollisionKey)
);
const DEFAULT_POLICY_MANAGED_LEAF_KEYS = new Set(
  ["agents.md", ".gitignore", ".env.example", ".env.sample", ".env.template"].map(toCollisionKey)
);
const PUBLIC_ENV_TEMPLATE_KEYS = new Set(
  [".env.example", ".env.sample", ".env.template"].map(toCollisionKey)
);
const DEFAULT_IGNORED_ROOT_KEYS = new Set(
  ["node_modules", "vendor", "build", "dist", ".cache", ".next", "coverage"].map(toCollisionKey)
);
const SECRET_SHAPED_LEAF =
  /(?:^|[._-])(?:secret|secrets|credential|credentials|password|private[_-]?key)(?:[._-]|$)|^\.env(?:\.|$)|(?:^|[._-])id_(?:rsa|dsa|ecdsa|ed25519)(?:[._-]|$)/iu;
const PRIVATE_KEY_EXTENSION = /\.(?:key|pem|p12|pfx|pkcs12)$/iu;

/**
 * Accepts only `/`-separated canonical relative identities. No absolute, UNC,
 * device, drive-relative, empty, dot, ADS, or normalization-alias segment may pass.
 */
export function validateEngineeringRelativePath(input: unknown): EngineeringRelativePathValidation {
  if (typeof input !== "string") return pathRejected("invalid_type");
  if (input.length === 0) return pathRejected("empty");
  if (
    input.startsWith("/") ||
    input.startsWith("\\") ||
    input.startsWith("//") ||
    input.startsWith("\\\\") ||
    /^[a-z]:/iu.test(input)
  ) {
    return pathRejected("absolute_or_namespace");
  }
  if (input.includes("\\") || input.includes("//") || input.endsWith("/")) {
    return pathRejected("non_canonical_relative_identity");
  }

  const segmentStrings = input.split("/");
  const segments: CanonicalLeafName[] = [];
  for (const segment of segmentStrings) {
    const validation = validateCanonicalLeafName(segment);
    if (!validation.ok) return pathRejected("invalid_segment");
    segments.push(validation.value);
  }
  return { ok: true, relativeIdentity: input, segments };
}

/**
 * Builds a policy projection from Main-owned inputs. It cannot downgrade the fixed
 * hard-denied categories; classification always resolves to the strictest match.
 */
export function createEngineeringPathPolicy(
  input: EngineeringPathPolicyInput = {}
): EngineeringPathPolicyCreation {
  const ignoredRelativeIdentityKeys = new Set<string>();
  const ignoredRootKeys = new Set(DEFAULT_IGNORED_ROOT_KEYS);
  const policyManagedLeafKeys = new Set(DEFAULT_POLICY_MANAGED_LEAF_KEYS);

  for (const identity of input.ignoredRelativeIdentities ?? []) {
    const validation = validateEngineeringRelativePath(identity);
    if (!validation.ok) return { ok: false, code: "invalid_policy" };
    ignoredRelativeIdentityKeys.add(relativeIdentityKey(validation.segments));
  }
  for (const root of input.ignoredRootNames ?? []) {
    const validation = validateCanonicalLeafName(root);
    if (!validation.ok) return { ok: false, code: "invalid_policy" };
    ignoredRootKeys.add(canonicalLeafNameCollisionKey(validation.value));
  }
  for (const leaf of input.policyManagedLeafNames ?? []) {
    const validation = validateCanonicalLeafName(leaf);
    if (!validation.ok) return { ok: false, code: "invalid_policy" };
    policyManagedLeafKeys.add(canonicalLeafNameCollisionKey(validation.value));
  }
  return {
    ok: true,
    value: {
      ignoredRelativeIdentityKeys,
      ignoredRootKeys,
      policyManagedLeafKeys
    }
  };
}

export function classifyEngineeringPath(
  input: unknown,
  policy: EngineeringPathPolicy = defaultEngineeringPathPolicy
): EngineeringPathClassificationResult {
  const validation = validateEngineeringRelativePath(input);
  if (!validation.ok) return validation;

  const keys = validation.segments.map(canonicalLeafNameCollisionKey);
  const leaf = validation.segments.at(-1);
  const leafKey = keys.at(-1);
  const relativeKey = relativeIdentityKey(validation.segments);
  const classification = isHardDenied(validation.segments, keys)
    ? "hard_denied"
    : policy.policyManagedLeafKeys.has(leafKey ?? "")
      ? "policy_managed"
      : policy.ignoredRelativeIdentityKeys.has(relativeKey) ||
          policy.ignoredRootKeys.has(keys[0] ?? "")
        ? "ignored_generated"
        : "ordinary";

  // The validated identity is returned to local callers only; failures never echo input or matching rules.
  return {
    ok: true,
    relativeIdentity: validation.relativeIdentity,
    classification: leaf === undefined ? "hard_denied" : classification
  };
}

export const defaultEngineeringPathPolicy: EngineeringPathPolicy = (() => {
  const created = createEngineeringPathPolicy();
  if (!created.ok) throw new Error("Engineering path policy initialization failed.");
  return created.value;
})();

function isHardDenied(segments: readonly CanonicalLeafName[], keys: readonly string[]): boolean {
  if (keys.some((key) => HARD_DENIED_NAMESPACE_KEYS.has(key))) return true;
  const leaf = segments.at(-1);
  const leafKey = keys.at(-1);
  if (
    segments.some(
      (segment, index) =>
        !PUBLIC_ENV_TEMPLATE_KEYS.has(keys[index] ?? "") && SECRET_SHAPED_LEAF.test(segment)
    )
  ) {
    return true;
  }
  return (
    leaf !== undefined &&
    !PUBLIC_ENV_TEMPLATE_KEYS.has(leafKey ?? "") &&
    PRIVATE_KEY_EXTENSION.test(leaf)
  );
}

function relativeIdentityKey(segments: readonly CanonicalLeafName[]): string {
  return segments.map(canonicalLeafNameCollisionKey).join("/");
}

function toCollisionKey(value: string): string {
  const validation = validateCanonicalLeafName(value);
  if (!validation.ok) throw new Error("Engineering path policy contains an invalid fixed name.");
  return canonicalLeafNameCollisionKey(validation.value);
}

function pathRejected(code: EngineeringPathRejectCode): EngineeringRelativePathValidation {
  return { ok: false, code };
}
