import type { NovelStudioApi, WorkspaceModelSharingDefaults } from "@novel-studio/application";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadWorkspaceModelSharingDefaults,
  saveWorkspaceModelSharingDefaults,
  shouldRequestWorkspaceModelSharingDefaults
} from "./model-sharing-defaults.js";

export function useModelSharingDialog(input: {
  readonly api: NovelStudioApi | undefined;
  readonly workspaceId: string | undefined;
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace" | "none";
  readonly agentErrorMessage?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [blockedSend, setBlockedSend] = useState(false);
  const [initialDefaults, setInitialDefaults] = useState<WorkspaceModelSharingDefaults | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const loadRequestRef = useRef(0);

  useEffect(() => {
    loadRequestRef.current += 1;
    setOpen(false);
    setBlockedSend(false);
    setInitialDefaults(null);
    setLoading(false);
    setLoadError(undefined);
  }, [input.workspaceId]);

  const openDialog = useCallback(
    (sendWasBlocked = false) => {
      const requestId = ++loadRequestRef.current;
      setOpen(true);
      setBlockedSend(sendWasBlocked);
      setLoading(true);
      setLoadError(undefined);
      void loadWorkspaceModelSharingDefaults(input.api).then((result) => {
        if (loadRequestRef.current !== requestId) return;
        setLoading(false);
        if (result.ok) {
          setInitialDefaults(result.value);
        } else {
          setLoadError(result.errorMessage);
        }
      });
    },
    [input.api]
  );

  useEffect(() => {
    if (
      shouldRequestWorkspaceModelSharingDefaults({
        workspaceKind: input.workspaceKind,
        ...(input.agentErrorMessage === undefined ? {} : { errorMessage: input.agentErrorMessage })
      })
    ) {
      openDialog(true);
    }
  }, [input.agentErrorMessage, input.workspaceId, input.workspaceKind, openDialog]);

  return {
    openDialog,
    dialogProps: {
      open,
      blockedSend,
      initialDefaults,
      loading,
      ...(loadError === undefined ? {} : { loadError }),
      onClose: () => setOpen(false),
      onSave: (defaults: WorkspaceModelSharingDefaults) =>
        saveWorkspaceModelSharingDefaults(input.api, defaults)
    }
  };
}
