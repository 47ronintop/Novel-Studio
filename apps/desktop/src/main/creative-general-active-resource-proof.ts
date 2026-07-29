import type {
  CreativeProjectFileDocument,
  CreativeProjectFileSession,
  CreativeProjectFileSessionIdentity,
  CreativeProjectFileTreeSnapshot
} from "@novel-studio/application";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { posix as pathPosix } from "node:path";

export interface CreativeGeneralActiveResourceReference {
  readonly refId: string;
  readonly relativePath: string;
  readonly label: string;
  readonly expectedChecksum?: string;
  readonly range?: unknown;
}

export interface CreativeGeneralActiveResourceProof {
  /** Revalidates and records the active Main-owned creative Files surface. */
  attestFilesSurface(input: {
    readonly identity: CreativeProjectFileSessionIdentity;
    readonly session: CreativeProjectFileSession;
  }): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>>;
  /** Binds an existing Files-surface proof to a document returned by Main's read/save session. */
  recordResource(input: {
    readonly identity: CreativeProjectFileSessionIdentity;
    readonly document: CreativeProjectFileDocument;
  }): void;
  /** Requires a previously attested Files surface, but deliberately permits no active resource. */
  verifyFilesSurface(input: {
    readonly identity: CreativeProjectFileSessionIdentity;
    readonly session: CreativeProjectFileSession;
  }): Promise<Result<void, UnifiedError>>;
  /** Requires both the Files surface and an exact, fresh resource proof. */
  verifyReference(input: {
    readonly identity: CreativeProjectFileSessionIdentity;
    readonly reference: CreativeGeneralActiveResourceReference | null | undefined;
    readonly session: CreativeProjectFileSession;
  }): Promise<Result<void, UnifiedError>>;
  clearResource(): void;
  clear(): void;
}

interface ProvenCreativeGeneralSurface {
  readonly identity: CreativeProjectFileSessionIdentity;
  readonly treeRevision: string;
}

interface ProvenCreativeGeneralResource {
  readonly identity: CreativeProjectFileSessionIdentity;
  readonly path: string;
  readonly checksum: string;
}

/**
 * Main owns both proofs: a fresh CreativeProjectFileSession tree establishes the Files surface;
 * a document returned by that same Main session can bind the optional active resource to disk.
 */
export function createCreativeGeneralActiveResourceProof(): CreativeGeneralActiveResourceProof {
  let surface: ProvenCreativeGeneralSurface | undefined;
  let resource: ProvenCreativeGeneralResource | undefined;

  const clear = (): void => {
    surface = undefined;
    resource = undefined;
  };
  const clearResource = (): void => {
    resource = undefined;
  };

  const attestFilesSurface = async (input: {
    readonly identity: CreativeProjectFileSessionIdentity;
    readonly session: CreativeProjectFileSession;
  }): Promise<Result<CreativeProjectFileTreeSnapshot, UnifiedError>> => {
    const active = input.session.getActiveIdentity();
    if (active === undefined || !sameIdentity(active, input.identity)) {
      clear();
      return err(proofError("active_session_mismatch"));
    }
    const refreshed = await input.session.refresh(input.identity);
    if (!refreshed.ok) {
      clear();
      return refreshed;
    }
    if (!matchesSnapshot(refreshed.value, input.identity)) {
      clear();
      return err(proofError("tree_identity_mismatch"));
    }
    surface = {
      identity: input.identity,
      treeRevision: refreshed.value.treeRevision
    };
    if (resource !== undefined && !sameIdentity(resource.identity, input.identity)) clearResource();
    return refreshed;
  };

  const verifyFilesSurface = async (input: {
    readonly identity: CreativeProjectFileSessionIdentity;
    readonly session: CreativeProjectFileSession;
  }): Promise<Result<void, UnifiedError>> => {
    const current = surface;
    if (current === undefined || !sameIdentity(current.identity, input.identity)) {
      return err(proofError("missing_or_workspace_mismatch"));
    }
    const refreshed = await attestFilesSurface(input);
    return refreshed.ok ? ok(undefined) : refreshed;
  };

  return {
    attestFilesSurface,

    recordResource(input) {
      if (
        surface === undefined ||
        !sameIdentity(surface.identity, input.identity) ||
        !matchesDocument(input.document, input.identity, input.document.path)
      ) {
        if (resource !== undefined && sameIdentity(resource.identity, input.identity)) clearResource();
        return;
      }
      resource = {
        identity: input.identity,
        path: input.document.path,
        checksum: input.document.checksum
      };
    },

    verifyFilesSurface,

    async verifyReference(input) {
      const surfaceVerified = await verifyFilesSurface(input);
      if (!surfaceVerified.ok) return surfaceVerified;
      const current = resource;
      const reference = input.reference;
      if (
        current === undefined ||
        reference === null ||
        reference === undefined ||
        !sameIdentity(current.identity, input.identity) ||
        !matchesReference(reference, current)
      ) {
        return err(proofError("reference_mismatch"));
      }
      const document = await readVerifiedDocument({
        ...input,
        path: current.path
      });
      if (!document.ok) {
        clearResource();
        return document;
      }
      if (document.value.checksum !== current.checksum) {
        clearResource();
        return err(proofError("disk_checksum_stale"));
      }
      return ok(undefined);
    },

    clearResource,
    clear
  };
}

async function readVerifiedDocument(input: {
  readonly identity: CreativeProjectFileSessionIdentity;
  readonly path: string;
  readonly session: CreativeProjectFileSession;
}): Promise<Result<CreativeProjectFileDocument, UnifiedError>> {
  const active = input.session.getActiveIdentity();
  if (active === undefined || !sameIdentity(active, input.identity)) {
    return err(proofError("active_session_mismatch"));
  }
  const read = await input.session.readTextFile({ ...input.identity, path: input.path });
  if (!read.ok) return read;
  return matchesDocument(read.value, input.identity, input.path)
    ? read
    : err(proofError("document_identity_mismatch"));
}

function matchesReference(
  reference: CreativeGeneralActiveResourceReference,
  proven: ProvenCreativeGeneralResource
): boolean {
  return (
    reference.refId === `file:${proven.path}` &&
    reference.relativePath === proven.path &&
    reference.label === pathPosix.basename(proven.path) &&
    reference.expectedChecksum === proven.checksum &&
    reference.range === undefined
  );
}

function matchesSnapshot(
  snapshot: CreativeProjectFileTreeSnapshot,
  identity: CreativeProjectFileSessionIdentity
): boolean {
  return (
    snapshot.projectId === identity.projectId &&
    snapshot.workspaceId === identity.workspaceId &&
    typeof snapshot.treeRevision === "string" &&
    snapshot.treeRevision.length > 0
  );
}

function matchesDocument(
  document: CreativeProjectFileDocument,
  identity: CreativeProjectFileSessionIdentity,
  path: string
): boolean {
  return (
    document.projectId === identity.projectId &&
    document.workspaceId === identity.workspaceId &&
    document.path === path &&
    /^[a-f0-9]{64}$/u.test(document.checksum)
  );
}

function sameIdentity(
  left: CreativeProjectFileSessionIdentity,
  right: CreativeProjectFileSessionIdentity
): boolean {
  return left.projectId === right.projectId && left.workspaceId === right.workspaceId;
}

function proofError(reason: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED",
    category: "ValidationError",
    message: "An attested creative project Files surface is required for general file context.",
    recoverability: "user-action",
    suggestedAction: "Open the project Files surface and retry.",
    traceId: "desktop-creative-general-active-resource",
    redactedDetail: { reason }
  });
}
