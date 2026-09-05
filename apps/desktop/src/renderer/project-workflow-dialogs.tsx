import type { ProjectWorkflowProps } from "@novel-studio/ui";
import { ProjectCreateDialog, ProjectFolderImportDialog } from "@novel-studio/ui";

interface ProjectWorkflowDialogsProps {
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly projectCreateDialogOpen: boolean;
  readonly onProjectCreateDialogOpenChange: (open: boolean) => void;
  readonly onProjectTitleChange: (title: string) => void;
  readonly onProjectFolderNameChange: (folderName: string) => void;
  readonly onChooseCreateParentDirectory: () => void;
  readonly onCreateProject: () => void;
  readonly onFolderImportCandidateToggle: (relativePath: string, selected: boolean) => void;
  readonly onFolderImportCancel: () => void;
  readonly onFolderImportConfirm: () => void;
}

export function ProjectWorkflowDialogs(props: ProjectWorkflowDialogsProps) {
  const { projectWorkflow } = props;

  return (
    <>
      <ProjectCreateDialog
        open={props.projectCreateDialogOpen}
        titleInput={projectWorkflow?.projectTitleInput ?? ""}
        folderNameInput={projectWorkflow?.projectFolderNameInput ?? ""}
        {...(projectWorkflow?.selectedParentDisplayName === undefined
          ? {}
          : { selectedParentDisplayName: projectWorkflow.selectedParentDisplayName })}
        {...(projectWorkflow?.creationPreview === undefined
          ? {}
          : { creationPreview: projectWorkflow.creationPreview })}
        busy={projectWorkflow?.status === "creating"}
        {...(projectWorkflow?.feedback === undefined ? {} : { feedback: projectWorkflow.feedback })}
        onTitleChange={props.onProjectTitleChange}
        onFolderNameChange={props.onProjectFolderNameChange}
        onChooseParentDirectory={props.onChooseCreateParentDirectory}
        onCancel={() => props.onProjectCreateDialogOpenChange(false)}
        onCreate={props.onCreateProject}
      />
      {projectWorkflow?.folderImportPreview === undefined ? null : (
        <ProjectFolderImportDialog
          {...projectWorkflow.folderImportPreview}
          open
          busy={projectWorkflow.folderImportPreview.busy || projectWorkflow.status === "creating"}
          onCandidateToggle={props.onFolderImportCandidateToggle}
          onCancel={props.onFolderImportCancel}
          onConfirm={props.onFolderImportConfirm}
        />
      )}
    </>
  );
}
