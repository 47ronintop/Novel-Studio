import type { EngineeringWorkspaceSnapshot } from "@novel-studio/application";
import { useMemo } from "react";

import type { EngineeringEditorStateBinding } from "./plain-file-editor-bridge.js";

let nextEngineeringEditorInstanceId = 0;

export function useEngineeringEditorStateBinding(
  workspace: EngineeringWorkspaceSnapshot | undefined
): EngineeringEditorStateBinding | undefined {
  const rootBindingId = qualifiedEngineeringRootBindingId(workspace);
  return useMemo(
    () =>
      rootBindingId === undefined
        ? undefined
        : { rootBindingId, editorInstanceId: createEngineeringEditorInstanceId() },
    [rootBindingId]
  );
}

function qualifiedEngineeringRootBindingId(
  workspace: EngineeringWorkspaceSnapshot | undefined
): string | undefined {
  const rootBindingId = (
    workspace as (EngineeringWorkspaceSnapshot & { readonly rootBindingId?: unknown }) | undefined
  )?.rootBindingId;
  return typeof rootBindingId === "string" && rootBindingId.length > 0 ? rootBindingId : undefined;
}

function createEngineeringEditorInstanceId(): string {
  nextEngineeringEditorInstanceId += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return `engineering_file_editor_${randomId ?? `${Date.now()}_${nextEngineeringEditorInstanceId}`}`;
}
