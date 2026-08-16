import type { NovelStudioApi, WorkspaceModelSharingDefaults } from "@novel-studio/application";

export const AGENT_MODEL_SHARING_DEFAULTS_REQUIRED_MESSAGE =
  "当前项目尚未完成模型共享范围选择，Agent 未发送任何内容。请先完成该项目的共享范围设置后重试。";

export type WorkspaceModelSharingDefaultsLoadResult =
  | { readonly ok: true; readonly value: WorkspaceModelSharingDefaults | null }
  | { readonly ok: false; readonly errorMessage: string };

export function shouldRequestWorkspaceModelSharingDefaults(input: {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace" | "none";
  readonly errorMessage?: string;
}): boolean {
  return (
    input.workspaceKind !== "none" &&
    input.errorMessage === AGENT_MODEL_SHARING_DEFAULTS_REQUIRED_MESSAGE
  );
}

export async function saveWorkspaceModelSharingDefaults(
  api: NovelStudioApi | undefined,
  defaults: WorkspaceModelSharingDefaults
): Promise<string | undefined> {
  if (api === undefined) return "当前桌面端无法保存模型共享范围。请重启应用后重试。";
  try {
    // This Main-owned IPC persists the explicit choice and refreshes the active Agent runtime.
    const result = await api.workspace.updateContextPolicy({
      action: "set_sharing_defaults",
      defaults
    });
    return result.ok
      ? undefined
      : `保存共享范围失败（${result.error.code}）。请确认当前项目仍已打开后重试。`;
  } catch {
    return "保存共享范围失败。请确认当前项目仍已打开后重试。";
  }
}

export async function loadWorkspaceModelSharingDefaults(
  api: NovelStudioApi | undefined
): Promise<WorkspaceModelSharingDefaultsLoadResult> {
  if (api === undefined) {
    return {
      ok: false,
      errorMessage: "当前桌面端无法读取模型共享范围。请重启应用后重试。"
    };
  }
  try {
    const result = await api.workspace.readModelSharingDefaults();
    return result.ok
      ? { ok: true, value: result.value }
      : {
          ok: false,
          errorMessage: `读取共享范围失败（${result.error.code}）。请确认当前项目仍已打开后重试。`
        };
  } catch {
    return {
      ok: false,
      errorMessage: "读取共享范围失败。请确认当前项目仍已打开后重试。"
    };
  }
}
