import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import {
  buildWorkflowGraphViewModel,
  parseWorkflowDefinition,
  validateWorkflowGraph
} from "@novel-studio/workflow-engine";
import type {
  WorkflowGraphViewModel,
  WorkflowValidationReport
} from "@novel-studio/workflow-engine";

export type ConfigAssetType = "prompt" | "agent" | "workflow";
export type ConfigCreatedBy = "user" | "system" | "migration";

export interface ConfigAssetSnapshot {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly content: JsonObject;
  readonly workflowGraph?: ConfigWorkflowGraphSnapshot;
}

export interface ConfigWorkflowGraphSnapshot {
  readonly graph: WorkflowGraphViewModel;
  readonly validation: WorkflowValidationReport;
}

export interface ConfigVersionSummary {
  readonly versionId: string;
}

export interface ConfigAssetSaveInput {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly content: JsonObject;
  readonly createdBy?: ConfigCreatedBy;
}

export interface ConfigAssetRestoreInput {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly versionId: string;
  readonly createdBy?: ConfigCreatedBy;
}

export interface ConfigAssetPort {
  readConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<JsonObject, UnifiedError>>;
  writeConfigAsset(
    input: ConfigAssetSaveInput
  ): Promise<Result<ConfigVersionSummary, UnifiedError>>;
  restoreConfigAssetVersion(
    input: ConfigAssetRestoreInput
  ): Promise<Result<JsonObject, UnifiedError>>;
}

export interface ConfigStudioSession {
  loadConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  saveConfigAsset(input: ConfigAssetSaveInput): Promise<Result<ConfigVersionSummary, UnifiedError>>;
  restoreConfigAssetVersion(
    input: ConfigAssetRestoreInput
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
}

export interface ConfigStudioSessionOptions {
  readonly configAssetPort: ConfigAssetPort;
}

export function createConfigStudioSession(
  options: ConfigStudioSessionOptions
): ConfigStudioSession {
  return {
    async loadConfigAsset(assetType, assetId) {
      const content = await options.configAssetPort.readConfigAsset(assetType, assetId);
      if (!content.ok) {
        return content;
      }

      return {
        ok: true,
        value: {
          assetType,
          assetId,
          content: content.value,
          ...workflowGraphForContent(assetType, content.value, "config-studio-load")
        }
      };
    },

    async saveConfigAsset(input) {
      return options.configAssetPort.writeConfigAsset(input);
    },

    async restoreConfigAssetVersion(input) {
      const content = await options.configAssetPort.restoreConfigAssetVersion(input);
      if (!content.ok) {
        return content;
      }

      return {
        ok: true,
        value: {
          assetType: input.assetType,
          assetId: input.assetId,
          content: content.value,
          ...workflowGraphForContent(input.assetType, content.value, "config-studio-restore")
        }
      };
    }
  };
}

function workflowGraphForContent(
  assetType: ConfigAssetType,
  content: JsonObject,
  traceId: string
): { readonly workflowGraph: ConfigWorkflowGraphSnapshot } | Record<string, never> {
  if (assetType !== "workflow") {
    return {};
  }

  const parsed = parseWorkflowDefinition(content, { traceId });
  if (!parsed.ok) {
    return {};
  }

  return {
    workflowGraph: {
      graph: buildWorkflowGraphViewModel(parsed.value),
      validation: validateWorkflowGraph(parsed.value)
    }
  };
}
