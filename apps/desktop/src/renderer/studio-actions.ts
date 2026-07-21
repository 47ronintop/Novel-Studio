import type { ConfigStudioPanelProps } from "@novel-studio/ui";
import { useCallback } from "react";

import type { StudioBridge } from "./studio-bridge.js";

export function useStudioActions(
  studioBridge: StudioBridge | undefined,
  setStudio: (studio: ConfigStudioPanelProps | undefined) => void
) {
  const handleStudioAssetSelect = useCallback<
    NonNullable<ConfigStudioPanelProps["onAssetSelect"]>
  >(
    (assetType, assetId) => {
      if (studioBridge === undefined) {
        return;
      }

      void studioBridge.selectAsset(assetType, assetId).then(setStudio);
    },
    [studioBridge, setStudio]
  );

  const handleStudioContentChange = useCallback<
    NonNullable<ConfigStudioPanelProps["onContentChange"]>
  >(
    (nextContent) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.updateContent(nextContent));
    },
    [studioBridge, setStudio]
  );

  const handleStudioWorkflowNodeSelect = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowNodeSelect"]>
  >(
    (nodeId) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.selectWorkflowNode(nodeId));
    },
    [studioBridge, setStudio]
  );

  const handleStudioWorkflowEdgeSelect = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowEdgeSelect"]>
  >(
    (edgeId) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.selectWorkflowEdge(edgeId));
    },
    [studioBridge, setStudio]
  );

  const handleStudioWorkflowNodeEdit = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowNodeEdit"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.applyWorkflowNodeEdit(edit));
    },
    [studioBridge, setStudio]
  );

  const handleStudioWorkflowSemanticEdit = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowSemanticEdit"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.applyWorkflowSemanticEdit(edit));
    },
    [studioBridge, setStudio]
  );

  const handleStudioWorkflowLayoutChange = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowLayoutChange"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.updateWorkflowGraphLayout(edit));
    },
    [studioBridge, setStudio]
  );

  const handleStudioWorkflowNodeDragCommit = useCallback<
    NonNullable<ConfigStudioPanelProps["onWorkflowNodeDragCommit"]>
  >(
    (edit) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.commitWorkflowNodeDrag(edit));
    },
    [studioBridge, setStudio]
  );

  const handleStudioSave = useCallback<NonNullable<ConfigStudioPanelProps["onSave"]>>(() => {
    if (studioBridge === undefined) {
      return;
    }

    setStudio(studioBridge.beginSave());
    void studioBridge.save().then(setStudio);
  }, [studioBridge, setStudio]);

  const handleStudioRestoreVersion = useCallback<
    NonNullable<ConfigStudioPanelProps["onRestoreVersion"]>
  >(
    (versionId) => {
      if (studioBridge === undefined) {
        return;
      }

      setStudio(studioBridge.beginRestore());
      void studioBridge.restoreVersion(versionId).then(setStudio);
    },
    [studioBridge, setStudio]
  );

  return {
    handleStudioAssetSelect,
    handleStudioContentChange,
    handleStudioWorkflowNodeSelect,
    handleStudioWorkflowEdgeSelect,
    handleStudioWorkflowNodeEdit,
    handleStudioWorkflowSemanticEdit,
    handleStudioWorkflowLayoutChange,
    handleStudioWorkflowNodeDragCommit,
    handleStudioSave,
    handleStudioRestoreVersion
  };
}
