import { createUnifiedError, type JsonObject, type UnifiedError } from "@novel-studio/shared";

export function createPluginError(
  code: string,
  message: string,
  redactedDetail: JsonObject = {}
): UnifiedError {
  return createUnifiedError({
    code,
    category: "PluginError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the plugin manifest, permissions, and enabled state.",
    traceId: "plugin-engine",
    redactedDetail
  });
}
