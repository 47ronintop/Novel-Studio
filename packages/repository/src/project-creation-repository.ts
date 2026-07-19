import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError, validationError } from "./errors.js";
import type { ProjectSnapshot, ProjectType } from "./ports.js";
import { ProjectFileRepository } from "./project-repository.js";

export interface CreateCreativeProjectInput {
  readonly parentDirectory: string;
  readonly folderName: string;
  readonly projectId: string;
  readonly title: string;
  readonly language: string;
  readonly projectType?: string;
  readonly targetWordCount?: number;
}

export interface ProjectCreationResult {
  readonly projectRoot: string;
  readonly snapshot: ProjectSnapshot;
}

export interface ProjectCreationPreview {
  readonly parentDirectory: string;
  readonly folderName: string;
  readonly projectRoot: string;
  readonly parentDisplayName: string;
  readonly targetDisplayName: string;
}

export interface ProjectCreationFileRepositoryOptions {
  readonly traceId?: string;
  readonly now?: () => string;
}

interface ValidatedProjectTarget {
  readonly canonicalParent: string;
  readonly parentIdentity: DirectoryIdentity;
  readonly folderName: string;
  readonly projectRoot: string;
}

interface DirectoryIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

interface CreatedProjectDirectory {
  readonly canonicalParent: string;
  readonly parentIdentity: DirectoryIdentity;
  readonly projectIdentity: DirectoryIdentity;
}

export class ProjectCreationFileRepository {
  private readonly traceId: string;
  private readonly createdProjectDirectories = new Map<string, CreatedProjectDirectory>();

  public constructor(private readonly options: ProjectCreationFileRepositoryOptions = {}) {
    this.traceId = options.traceId ?? "trace_repository_project_creation";
  }

  public async previewProjectInParent(input: {
    readonly parentDirectory: string;
    readonly folderName: string;
  }): Promise<Result<ProjectCreationPreview, UnifiedError>> {
    const validated = await this.validateProjectTarget(input);
    if (!validated.ok) {
      return validated;
    }

    return ok({
      parentDirectory: validated.value.canonicalParent,
      folderName: validated.value.folderName,
      projectRoot: validated.value.projectRoot,
      parentDisplayName:
        basename(validated.value.canonicalParent) || validated.value.canonicalParent,
      targetDisplayName: validated.value.folderName
    });
  }

  public async createProjectInParent(
    input: CreateCreativeProjectInput
  ): Promise<Result<ProjectCreationResult, UnifiedError>> {
    const validated = await this.validateProjectTarget(input);
    if (!validated.ok) {
      return validated;
    }

    try {
      await mkdir(validated.value.projectRoot, { recursive: false });
    } catch (error) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        return this.targetExists();
      }

      return err(
        storageError({
          code: "PROJECT_CREATE_TARGET_FAILED",
          message: "The project child directory could not be created.",
          suggestedAction: "Choose a writable parent directory and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    const ownership = await this.captureCreatedProjectDirectory(validated.value);
    if (!ownership.ok) {
      return ownership;
    }
    this.createdProjectDirectories.set(validated.value.projectRoot, ownership.value);

    const projectRepository = new ProjectFileRepository({
      projectRoot: validated.value.projectRoot,
      ...(this.options.traceId === undefined ? {} : { traceId: this.options.traceId }),
      ...(this.options.now === undefined ? {} : { now: this.options.now })
    });

    let created: Result<ProjectSnapshot, UnifiedError>;
    try {
      created = await projectRepository.createProject({
        projectId: input.projectId,
        title: input.title,
        language: input.language,
        ...(input.projectType === undefined
          ? {}
          : { projectType: input.projectType as ProjectType }),
        ...(input.targetWordCount === undefined ? {} : { targetWordCount: input.targetWordCount })
      });
    } catch (error) {
      await this.cleanupOwnedCreatedProject(validated.value.projectRoot);
      return err(
        storageError({
          code: "PROJECT_CREATE_FAILED",
          message: "The project could not be initialized in its child directory.",
          suggestedAction: "Check the parent directory and retry project creation.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown initialization error"
          }
        })
      );
    }

    if (!created.ok) {
      await this.cleanupOwnedCreatedProject(validated.value.projectRoot);
      return created;
    }

    return ok({
      projectRoot: validated.value.projectRoot,
      snapshot: created.value
    });
  }

  public async cleanupCreatedProject(projectRoot: string): Promise<Result<void, UnifiedError>> {
    return this.cleanupOwnedCreatedProject(projectRoot);
  }

  private async cleanupOwnedCreatedProject(
    projectRoot: string
  ): Promise<Result<void, UnifiedError>> {
    const resolvedProjectRoot = resolve(projectRoot);
    const ownership = this.createdProjectDirectories.get(resolvedProjectRoot);
    if (ownership === undefined || dirname(resolvedProjectRoot) !== ownership.canonicalParent) {
      return this.cleanupRejected("The requested path is not a project created by this operation.");
    }

    try {
      const targetStat = await lstat(resolvedProjectRoot, { bigint: true }).catch(
        (error: unknown) => {
          if (isNodeErrorWithCode(error, "ENOENT")) {
            return undefined;
          }
          throw error;
        }
      );
      if (targetStat === undefined) {
        this.createdProjectDirectories.delete(resolvedProjectRoot);
        return ok(undefined);
      }

      const parentStat = await lstat(ownership.canonicalParent, { bigint: true });
      if (
        !parentStat.isDirectory() ||
        parentStat.isSymbolicLink() ||
        !sameDirectoryIdentity(identityOf(parentStat), ownership.parentIdentity) ||
        !targetStat.isDirectory() ||
        targetStat.isSymbolicLink() ||
        !sameDirectoryIdentity(identityOf(targetStat), ownership.projectIdentity)
      ) {
        return this.cleanupRejected("The created project path changed before cleanup.");
      }

      await rm(resolvedProjectRoot, { recursive: true, force: true });
      this.createdProjectDirectories.delete(resolvedProjectRoot);
      return ok(undefined);
    } catch (error) {
      return err(
        storageError({
          code: "PROJECT_CREATE_CLEANUP_FAILED",
          message: "The incomplete project child directory could not be removed.",
          suggestedAction: "Inspect and remove only the incomplete project folder.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown cleanup error"
          }
        })
      );
    }
  }

  private async validateProjectTarget(input: {
    readonly parentDirectory: string;
    readonly folderName: string;
  }): Promise<Result<ValidatedProjectTarget, UnifiedError>> {
    const normalized = input.folderName.normalize("NFKC");
    if (normalized.length === 0 || normalized !== normalized.trim()) {
      return this.invalidFolderName();
    }
    if (normalized === "." || normalized === "..") {
      return this.invalidFolderName();
    }
    // eslint-disable-next-line no-control-regex -- Windows forbids ASCII control chars in names.
    if (/[<>:"/\\|?*\u0000-\u001f]/u.test(normalized)) {
      return this.invalidFolderName();
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(normalized)) {
      return this.invalidFolderName();
    }
    if (/[. ]$/u.test(normalized)) {
      return this.invalidFolderName();
    }

    let canonicalParent: string;
    let parentIdentity: DirectoryIdentity;
    try {
      canonicalParent = await realpath(input.parentDirectory);
      const parentStat = await lstat(canonicalParent, { bigint: true });
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
        return this.invalidParent();
      }
      parentIdentity = identityOf(parentStat);
    } catch {
      return this.invalidParent();
    }

    const projectRoot = resolve(canonicalParent, normalized);
    if (dirname(projectRoot) !== canonicalParent) {
      return this.invalidFolderName();
    }

    try {
      await lstat(projectRoot);
      return this.targetExists();
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        return err(
          storageError({
            code: "PROJECT_CREATE_TARGET_CHECK_FAILED",
            message: "The project child path could not be checked safely.",
            suggestedAction: "Check the parent directory permissions and retry.",
            traceId: this.traceId,
            redactedDetail: {
              reason: error instanceof Error ? error.message : "Unknown target check error"
            }
          })
        );
      }
    }

    return ok({
      canonicalParent,
      parentIdentity,
      folderName: normalized,
      projectRoot
    });
  }

  private async captureCreatedProjectDirectory(
    target: ValidatedProjectTarget
  ): Promise<Result<CreatedProjectDirectory, UnifiedError>> {
    try {
      const parentStat = await lstat(target.canonicalParent, { bigint: true });
      const projectStat = await lstat(target.projectRoot, { bigint: true });
      if (
        !parentStat.isDirectory() ||
        parentStat.isSymbolicLink() ||
        !sameDirectoryIdentity(identityOf(parentStat), target.parentIdentity) ||
        !projectStat.isDirectory() ||
        projectStat.isSymbolicLink()
      ) {
        return this.createdTargetChanged();
      }

      return ok({
        canonicalParent: target.canonicalParent,
        parentIdentity: target.parentIdentity,
        projectIdentity: identityOf(projectStat)
      });
    } catch (error) {
      return this.createdTargetChanged(error);
    }
  }

  private cleanupRejected(message: string): Result<never, UnifiedError> {
    return err(
      validationError({
        code: "PROJECT_CREATE_CLEANUP_REJECTED",
        message,
        suggestedAction: "Inspect the project path and leave unrelated folders unchanged.",
        traceId: this.traceId
      })
    );
  }

  private createdTargetChanged(error?: unknown): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "PROJECT_CREATE_TARGET_CHANGED",
        message: "The new project child directory changed during initialization.",
        suggestedAction: "Inspect the parent directory before retrying project creation.",
        traceId: this.traceId,
        ...(error === undefined
          ? {}
          : {
              redactedDetail: {
                reason: error instanceof Error ? error.message : "Unknown identity error"
              }
            })
      })
    );
  }

  private invalidFolderName(): Result<never, UnifiedError> {
    return err(
      validationError({
        code: "PROJECT_CREATE_FOLDER_NAME_INVALID",
        message: "The project folder name is not safe to create.",
        suggestedAction: "Choose a single folder name without reserved characters or words.",
        traceId: this.traceId
      })
    );
  }

  private invalidParent(): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "PROJECT_CREATE_PARENT_INVALID",
        message: "The selected parent path is not an existing directory.",
        suggestedAction: "Choose an existing writable parent directory.",
        traceId: this.traceId
      })
    );
  }

  private targetExists(): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "PROJECT_CREATE_TARGET_EXISTS",
        message: "A file or folder already exists at the requested project path.",
        suggestedAction: "Choose a different project folder name or open the existing project.",
        traceId: this.traceId
      })
    );
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}

function identityOf(stat: { readonly dev: bigint; readonly ino: bigint }): DirectoryIdentity {
  return {
    device: stat.dev,
    inode: stat.ino
  };
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}
