import { createHash } from "node:crypto";

import {
  DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT,
  PROJECT_CONVENTIONS_READER_VERSION,
  contextSourceMaterializationArtifactId,
  createAgentContextSourceMaterializationArtifact,
  truncateContextText,
  type ProjectConventionsReadInput,
  type ProjectConventionsReadResult,
  type ProjectConventionsReader,
  type WorkspaceProjectContextIdentity,
  type WorkspaceProjectContextProfileId
} from "@novel-studio/application";
import {
  createDeterministicTokenEstimator,
  type AgentContextSourceInput,
  type AgentTokenEstimator
} from "@novel-studio/agent-engine";
import type { AgentProjectReadRepository } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopProjectConventionsReaderOptions {
  /** Bound to Main's canonical-root/no-symlink guarded project repository. */
  readonly projectReads: Pick<AgentProjectReadRepository, "readText">;
  readonly estimator?: AgentTokenEstimator;
}

/**
 * Main-owned fixed-path reader for workspace conventions. It deliberately accepts no path or root
 * from callers; the repository closes over the canonical project root.
 */
export class DesktopProjectConventionsReader implements ProjectConventionsReader {
  private readonly estimator: AgentTokenEstimator;

  public constructor(private readonly options: DesktopProjectConventionsReaderOptions) {
    this.estimator = options.estimator ?? createDeterministicTokenEstimator();
  }

  public async read(
    input: ProjectConventionsReadInput
  ): Promise<Result<ProjectConventionsReadResult, UnifiedError>> {
    if (!input.enabled) return ok({ status: "disabled" });
    if (input.workspaceTrust === "untrusted") return ok({ status: "untrusted" });

    const relativePath = conventionsPath(input.profileId);
    if (!isProfileWorkspaceCombination(input)) {
      return err(
        createUnifiedError({
          code: "AGENT_PROJECT_CONVENTIONS_PROFILE_INVALID",
          category: "ValidationError",
          message: "The workspace identity does not match the resolved conventions profile.",
          recoverability: "user-action",
          suggestedAction: "Resolve a workspace profile before reading project conventions.",
          traceId: "desktop-project-conventions-reader"
        })
      );
    }

    const maxTokens = Math.min(DEFAULT_PROJECT_CONVENTIONS_TOKEN_LIMIT, input.maxTokens);
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 0) {
      return err(
        createUnifiedError({
          code: "AGENT_PROJECT_CONVENTIONS_TOKEN_LIMIT_INVALID",
          category: "ValidationError",
          message: "The project conventions token limit is invalid.",
          recoverability: "user-action",
          suggestedAction: "Use a non-negative integer token limit.",
          traceId: "desktop-project-conventions-reader"
        })
      );
    }

    const read = await this.options.projectReads.readText(relativePath);
    if (!read.ok) {
      if (read.error.code === "AGENT_PROJECT_FILE_NOT_FOUND") return ok({ status: "missing" });
      return err(read.error);
    }

    const truncated = truncateContextText({
      text: read.value.content,
      maxTokens,
      estimator: this.estimator,
      modelProfileId: input.modelProfileId
    });
    const sourceIdentity = conventionSourceIdentity(input.workspace, input.profileId, relativePath);
    const injectedChecksum = checksumText(truncated.text);
    const artifactId = contextSourceMaterializationArtifactId("project_conventions", {
      readerVersion: PROJECT_CONVENTIONS_READER_VERSION,
      sourceIdentity,
      originalChecksum: read.value.checksum,
      injectedChecksum,
      tokenCount: truncated.tokenCount,
      truncationRange: truncated.truncationRange
    });
    const source: AgentContextSourceInput = {
      refId: projectConventionsRefId(sourceIdentity),
      sourceKind: "project_conventions",
      relativePath,
      content: truncated.text,
      dirty: false,
      materialization: {
        schemaVersion: "1.0",
        kind: "project_conventions",
        artifactId,
        readerVersion: PROJECT_CONVENTIONS_READER_VERSION,
        sourceIdentity,
        instructionPolicy: "content_is_data_not_authority",
        workspaceTrust: input.workspaceTrust,
        tokenCount: truncated.tokenCount,
        truncationRange: truncated.truncationRange,
        originalChecksum: read.value.checksum,
        injectedChecksum
      }
    };
    const artifact = createAgentContextSourceMaterializationArtifact(source);
    return ok({ status: "available", source, artifact });
  }
}

export function createDesktopProjectConventionsReader(
  options: DesktopProjectConventionsReaderOptions
): ProjectConventionsReader {
  return new DesktopProjectConventionsReader(options);
}

function projectConventionsRefId(
  sourceIdentity: ReturnType<typeof conventionSourceIdentity>
): string {
  return `project_conventions_${checksumText(
    JSON.stringify({ readerVersion: PROJECT_CONVENTIONS_READER_VERSION, sourceIdentity })
  ).slice(0, 32)}`;
}

function conventionsPath(profileId: WorkspaceProjectContextProfileId): string {
  return profileId === "engineering" ? "AGENTS.md" : "conventions/writing.md";
}

function conventionSourceIdentity(
  workspace: WorkspaceProjectContextIdentity,
  profileId: WorkspaceProjectContextProfileId,
  relativePath: string
) {
  return {
    workspaceId: workspace.workspaceId,
    contextProfileId: profileId,
    canonicalRootIdentity: workspace.canonicalRootIdentity,
    relativePath
  } as const;
}

function isProfileWorkspaceCombination(input: ProjectConventionsReadInput): boolean {
  return input.profileId === "engineering"
    ? input.workspace.workspaceKind === "engineeringWorkspace"
    : input.workspace.workspaceKind === "creativeProject";
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
