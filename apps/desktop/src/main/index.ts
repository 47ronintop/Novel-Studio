import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBootstrappedDefaultDesktopApplicationWithSnapshot,
  createProjectLockOwnerId,
  createUnboundDesktopApplication,
  DEFAULT_FIXTURE_CHAPTER_ID
} from "./application-composition.js";
import { createDesktopAgentRuntime } from "./agent-run-runtime.js";
import { createDesktopStandaloneAgentRuntime } from "./standalone-agent-runtime.js";
import { createDesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import type { DesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import {
  createDesktopNetworkSettingsSession,
  createDesktopNetworkToolExecutor
} from "./agent-network-runtime.js";
import { createAgentFeatureFlags } from "./agent-feature-flags.js";
import {
  createDesktopAgentNetworkSettingsPort,
  createDesktopMcpSettingsPort
} from "./agent-tool-settings-store.js";
import { createDesktopCreativeProjectFileReceiptStore } from "./creative-project-file-receipt-store.js";
import { createDesktopWorkspaceContextPolicyStore } from "./workspace-context-policy-store.js";
import { createCreativeGeneralActiveResourceProof } from "./creative-general-active-resource-proof.js";
import { connectRemoteMcp, createRemoteMcpDispatch } from "./remote-mcp-runtime.js";
import { createAgentWriteSaveCoordinator, createApplicationIpcHandlers } from "./ipc-handlers.js";
import { createWorkspaceActivationCoordinator } from "./workspace-activation.js";
import { createApplicationMenuTemplate } from "./menu.js";
import { createDesktopModelRuntime, createEncryptedFileModelSecretStore } from "./model-runtime.js";
import { createSecureWebPreferences } from "./security.js";
import {
  createAgentPricingRegistry,
  createAgentExternalToolSession,
  createCreativeProjectFileSession,
  createMcpSettingsSession,
  mangleToolId,
  reasoningStrengthForModel,
  resolveCatalogAgentModelCapabilities
} from "@novel-studio/application";
import { CreativeProjectFileRepository } from "@novel-studio/repository";
import type {
  AgentNetworkPolicy,
  AgentNetworkSettingsPort,
  AgentNetworkSettingsSession,
  AgentNetworkToolExecutor,
  AgentExternalToolExecutor,
  DesktopApplication,
  McpServerConfig,
  McpSettingsData,
  McpSettingsSession
} from "@novel-studio/application";
import type { LlmModelProfile, LlmProviderId } from "@novel-studio/llm-adapter";
import {
  STANDALONE_AGENT_CONTEXT_SCOPE,
  agentContextScopeKey,
  computeAgentToolDescriptorDigest,
  MAX_EXTERNAL_TOOL_DESCRIPTORS,
  NO_AGENT_PROMPT_CACHE_CAPABILITY,
  validateExternalToolDescriptors
} from "@novel-studio/agent-engine";
import type { AgentToolDescriptor } from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type { DesktopModelRuntime, ModelSecretStore } from "./model-runtime.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let activeDesktopApplication: DesktopApplication | undefined;
let activeAgentRuntimeManager: DesktopAgentRuntimeManager | undefined;
let activeDesktopModelRuntime: DesktopModelRuntime | undefined;
let shutdownInProgress = false;

export async function registerApplicationIpcHandlers(): Promise<void> {
  const userDataRoot = process.env["NOVEL_STUDIO_USER_DATA_ROOT"] ?? app.getPath("userData");
  const fixtureProjectRoot = process.env["NOVEL_STUDIO_PROJECT_ROOT"];
  const modelSecretStore = createEncryptedFileModelSecretStore({
    userDataRoot,
    cipher: safeStorage
  });
  const modelRuntime = createDesktopModelRuntime({
    userDataRoot,
    secretStore: modelSecretStore
  });
  activeDesktopModelRuntime = modelRuntime;
  const projectLockOwnerId = createProjectLockOwnerId();
  const agentWriteSaveCoordinator = createAgentWriteSaveCoordinator();
  const workspaceContextPolicyStore = createDesktopWorkspaceContextPolicyStore({ userDataRoot });
  const creativeGeneralActiveResourceProof = createCreativeGeneralActiveResourceProof();
  const creativeProjectFileSession = createCreativeProjectFileSession({
    createRepository: (activation) =>
      new CreativeProjectFileRepository({
        projectRoot: activation.projectRoot,
        projectId: activation.projectId,
        workspaceId: activation.workspaceId,
        receiptStore: createDesktopCreativeProjectFileReceiptStore({
          stateRoot: activation.stateRoot ?? activation.projectRoot,
          projectId: activation.projectId,
          workspaceId: activation.workspaceId
        })
      })
  });
  const agentPricingRegistry = createAgentPricingRegistry({
    version: "stage-5-2026-07-15",
    entries: []
  });
  const agentNetworkSettingsPort = createDesktopAgentNetworkSettingsPort({ userDataRoot });
  const agentNetworkSettingsSession = createDesktopNetworkSettingsSession({
    settingsPort: agentNetworkSettingsPort,
    resolveSecret: async (secretRef) => {
      const secret = await modelSecretStore.readSecret(secretRef);
      return secret.ok ? secret.value : undefined;
    }
  });
  const agentMcpSettingsPort = createDesktopMcpSettingsPort({ userDataRoot });
  const agentMcpSettingsSession = createMcpSettingsSession({
    port: agentMcpSettingsPort,
    testRemoteConnection: (config) =>
      testDesktopRemoteMcpConnection({
        config,
        networkSettingsSession: agentNetworkSettingsSession,
        readMcpSettings: () => agentMcpSettingsPort.readMcpSettings(),
        modelSecretStore
      })
  });
  const bootstrapped =
    fixtureProjectRoot === undefined
      ? undefined
      : await createBootstrappedDefaultDesktopApplicationWithSnapshot({
          projectRoot: fixtureProjectRoot,
          userDataRoot,
          projectLockOwnerId,
          modelConnectionTester: modelRuntime.modelConnectionTester,
          modelDiscoveryPort: modelRuntime.modelDiscoveryPort,
          createAiProvider: modelRuntime.createAiProvider
        });
  const application =
    bootstrapped?.application ??
    (await createUnboundDesktopApplication({
      userDataRoot,
      projectLockOwnerId,
      modelConnectionTester: modelRuntime.modelConnectionTester,
      modelDiscoveryPort: modelRuntime.modelDiscoveryPort,
      createAiProvider: modelRuntime.createAiProvider
    }));
  activeDesktopApplication = application;
  const failAgentWriteAt = readPositiveInteger(
    process.env["NOVEL_STUDIO_TEST_AGENT_WRITE_FAIL_AT"]
  );
  const resolveAgentModelProfile = (profileId: string, modelNameOverride?: string) =>
    resolveDesktopAgentModelProfile(activeDesktopApplication, profileId, modelNameOverride);
  const resolveAgentModelStartFacts = (profileId: string, modelNameOverride?: string) =>
    resolveDesktopAgentModelStartFacts(
      activeDesktopApplication,
      modelSecretStore,
      profileId,
      modelNameOverride
    );
  const agentRuntimeManager = createDesktopAgentRuntimeManager({
    createRuntime: async (binding) => {
      const workspaceContextPolicy = await workspaceContextPolicyStore.read({
        workspaceKind: binding.kind,
        workspaceId: binding.workspaceId,
        contentRoot: binding.contentRoot
      });
      const networkRuntime = await resolveDesktopNetworkRuntime({
        settingsSession: agentNetworkSettingsSession,
        settingsPort: agentNetworkSettingsPort,
        modelSecretStore
      });
      const mcpRuntime = await resolveDesktopMcpRuntime({
        settingsSession: agentMcpSettingsSession,
        networkSettingsSession: agentNetworkSettingsSession,
        modelSecretStore
      });
      const featureFlags = createAgentFeatureFlags({
        phaseA_searchEnabled: true,
        phaseB_fileLifecycleEnabled: true,
        phaseD_networkReadEnabled: networkRuntime.executor !== undefined,
        phaseE_remoteMcpEnabled: mcpRuntime.executor !== undefined,
        revision: `desktop-main:${networkRuntime.policyRevision}:${mcpRuntime.settingsRevision}:workspace-context-${workspaceContextPolicy.policyRevision}`
      });
      return createDesktopAgentRuntime({
        workspaceKind: binding.kind,
        projectId: binding.workspaceId,
        contentRoot: binding.contentRoot,
        stateRoot: binding.stateRoot,
        workspaceTrust: workspaceContextPolicy.workspaceTrust,
        projectConventionsEnabled: workspaceContextPolicy.projectConventionsEnabled,
        ...(binding.activeChapterId === undefined
          ? {}
          : { activeChapterId: binding.activeChapterId }),
        userDataRoot,
        featureFlags,
        ...(networkRuntime.executor === undefined
          ? {}
          : { networkToolExecutor: networkRuntime.executor }),
        dataEgressPolicy: networkRuntime.dataEgressPolicy,
        ...(mcpRuntime.executor === undefined
          ? {}
          : {
              externalToolExecutor: mcpRuntime.executor,
              externalToolDescriptors: mcpRuntime.descriptors,
              disposeExternalTools: mcpRuntime.dispose
            }),
        pricingRegistry: agentPricingRegistry,
        projectLockOwnerId,
        pauseAutosave: agentWriteSaveCoordinator.pauseAutosave,
        resumeAutosave: agentWriteSaveCoordinator.resumeAutosave,
        ...(failAgentWriteAt === undefined ? {} : { failAgentWriteAt }),
        createAgentModelDriver: modelRuntime.createAgentModelDriver,
        releasePromptCacheScope: () =>
          modelRuntime.releasePromptCacheScope(
            agentContextScopeKey({
              kind: "workspace",
              workspaceKind: binding.kind,
              workspaceId: binding.workspaceId
            })
          ),
        ...(binding.kind !== "creativeProject"
          ? {}
          : {
              notifyProjectFilesChanged: (input) =>
                application.notifyProjectSearchSourcesChanged({
                  projectId: binding.workspaceId,
                  reason: input.reason,
                  relativePaths: input.relativePaths
                }),
              getCreativeProjectFileTreeSnapshot: () => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                const snapshot = creativeProjectFileSession.getSnapshot();
                return identity?.workspaceId === binding.workspaceId &&
                  snapshot?.workspaceId === binding.workspaceId
                  ? snapshot
                  : undefined;
              },
              reattestCreativeProjectFileTreeSnapshot: async () => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (
                  identity === undefined ||
                  identity.projectId !== binding.workspaceId ||
                  identity.workspaceId !== binding.workspaceId
                ) {
                  return err(
                    createUnifiedError({
                      code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED",
                      category: "ValidationError",
                      message: "The active creative project file session does not match this run.",
                      recoverability: "user-action",
                      suggestedAction: "Reopen the creative project and retry.",
                      traceId: "desktop-agent-creative-project-file-reattest"
                    })
                  );
                }
                return creativeProjectFileSession.refresh(identity);
              },
              readCreativeProjectFile: async (relativePath: string) => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (identity === undefined || identity.workspaceId !== binding.workspaceId) {
                  return err(
                    createUnifiedError({
                      code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED",
                      category: "ValidationError",
                      message: "The active creative project file session does not match this run.",
                      recoverability: "user-action",
                      suggestedAction: "Reopen the creative project and retry.",
                      traceId: "desktop-agent-creative-project-file-reader"
                    })
                  );
                }
                return creativeProjectFileSession.readTextFile({ ...identity, path: relativePath });
              },
              verifyCreativeGeneralActiveResource: async (reference) => {
                const identity = creativeProjectFileSession.getActiveIdentity();
                if (identity === undefined || identity.workspaceId !== binding.workspaceId) {
                  return err(
                    createUnifiedError({
                      code: "CREATIVE_PROJECT_FILE_SESSION_IDENTITY_REJECTED",
                      category: "ValidationError",
                      message: "The active creative project file session does not match this run.",
                      recoverability: "user-action",
                      suggestedAction: "Reopen the creative project and retry.",
                      traceId: "desktop-agent-creative-project-file-proof"
                    })
                  );
                }
                const proofInput = { identity, session: creativeProjectFileSession };
                return reference === null
                  ? creativeGeneralActiveResourceProof.verifyFilesSurface(proofInput)
                  : creativeGeneralActiveResourceProof.verifyReference({
                      ...proofInput,
                      reference
                    });
              }
            }),
        readEditorBuffer: async (refId) => {
          const chapterId = refId.startsWith("chapter:")
            ? refId.slice("chapter:".length)
            : undefined;
          if (chapterId === undefined || activeDesktopApplication === undefined) return undefined;
          const activeChapter = await activeDesktopApplication.readActiveChapterState();
          return activeChapter.ok && activeChapter.value.state.chapter.frontmatter.id === chapterId
            ? activeChapter.value.state.chapter.body
            : undefined;
        },
        readEditorState: async (relativePath) => {
          const match = /^chapters\/([A-Za-z0-9_-]+)\.md$/.exec(relativePath);
          if (match?.[1] === undefined || activeDesktopApplication === undefined) return undefined;
          const activeChapter = await activeDesktopApplication.readActiveChapterState();
          if (!activeChapter.ok || activeChapter.value.state.chapter.frontmatter.id !== match[1]) {
            return undefined;
          }
          return {
            dirty: activeChapter.value.state.dirty,
            content: activeChapter.value.state.chapter.body
          };
        },
        syncSavedEditor: async (relativePath, options) => {
          await syncSavedEditorForPath(activeDesktopApplication, relativePath, options);
        },
        resolveModelProfile: resolveAgentModelProfile,
        resolveModelStartFacts: resolveAgentModelStartFacts
      });
    },
    createStandaloneRuntime: async () => {
      const created = await createDesktopStandaloneAgentRuntime({
        userDataRoot,
        createAgentModelDriver: modelRuntime.createAgentModelDriver,
        releasePromptCacheScope: () =>
          modelRuntime.releasePromptCacheScope(
            agentContextScopeKey(STANDALONE_AGENT_CONTEXT_SCOPE)
          ),
        resolveModelProfile: resolveAgentModelProfile,
        resolveModelStartFacts: resolveAgentModelStartFacts
      });
      if (!created.ok) throw new Error(created.error.message);
      return created.value;
    }
  });
  if (bootstrapped !== undefined) {
    const workspaceId = bootstrapped.workspace.project.projectId;
    const fileSession = await creativeProjectFileSession.activate({
      projectId: workspaceId,
      workspaceId,
      projectRoot: bootstrapped.workspace.projectRoot
    });
    if (!fileSession.ok) {
      agentRuntimeManager.dispose();
      await modelRuntime.dispose();
      await application.shutdown();
      activeDesktopApplication = undefined;
      activeDesktopModelRuntime = undefined;
      throw new Error(fileSession.error.message);
    }
    const initialBinding = await agentRuntimeManager.bindWorkspace({
      kind: "creativeProject",
      workspaceId,
      contentRoot: bootstrapped.workspace.projectRoot,
      stateRoot: bootstrapped.workspace.projectRoot,
      activeChapterId:
        bootstrapped.workspace.activeChapterId ??
        bootstrapped.workspace.chapters[0]?.id ??
        DEFAULT_FIXTURE_CHAPTER_ID
    });
    if (!initialBinding.ok) {
      creativeProjectFileSession.deactivate();
      agentRuntimeManager.dispose();
      await modelRuntime.dispose();
      await application.shutdown();
      activeDesktopApplication = undefined;
      activeDesktopModelRuntime = undefined;
      throw new Error(initialBinding.error.message);
    }
  } else {
    const standalonePrepared = await agentRuntimeManager.prepareStandalone();
    if (!standalonePrepared.ok) {
      process.emitWarning(standalonePrepared.error.message, {
        code: standalonePrepared.error.code,
        detail: "Standalone Agent is disabled; workspace open/create remains available."
      });
    } else {
      const standaloneActivated = await agentRuntimeManager.activateStandalone();
      if (!standaloneActivated.ok) {
        process.emitWarning(standaloneActivated.error.message, {
          code: standaloneActivated.error.code,
          detail: "Standalone Agent is disabled; workspace open/create remains available."
        });
      }
    }
  }
  activeAgentRuntimeManager = agentRuntimeManager;
  const workspaceActivationCoordinator = createWorkspaceActivationCoordinator({
    application,
    runtimeManager: agentRuntimeManager,
    creativeProjectFileSession,
    clearCreativeGeneralActiveResourceProof: () => creativeGeneralActiveResourceProof.clear(),
    reportCleanupFailure: (error) => {
      process.emitWarning(error.message, {
        code: error.code,
        detail: `Workspace cleanup will be retried during shutdown (${error.traceId}).`
      });
    }
  });
  const handlers = createApplicationIpcHandlers(activeDesktopApplication, {
    chooseOpenProjectDirectory: () => chooseProjectDirectory("Open Novel Studio project"),
    chooseCreateProjectDirectory: () => chooseProjectDirectory("Create Novel Studio project"),
    chooseEngineeringDirectory: () => chooseProjectDirectory("Open engineering workspace"),
    chooseProjectTextFile: (workspaceRoot) => chooseProjectTextFile(workspaceRoot),
    workspaceActivationCoordinator,
    modelSecretStore,
    publishAiSuggestionStreamEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:ai:chapter-suggestion-push-event", event);
        }
      }
    },
    agentRuntimeManager,
    workspaceContextPolicyStore,
    creativeProjectFileSession,
    creativeGeneralActiveResourceProof,
    agentWriteSaveCoordinator,
    agentNetworkSettingsSession,
    agentMcpSettingsSession,
    onAgentSettingsChanged: async () => {
      // The durable setting has already changed. Revoke Main-owned network/MCP access before any
      // asynchronous stop/list/refresh work so the prior frozen runtime cannot dispatch again.
      agentRuntimeManager.revokeCurrentSettingsCapabilities();
      const refreshed = await agentRuntimeManager.refreshCurrentWorkspace();
      return refreshed;
    },
    publishAgentRunEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:agent-run:event", event);
        }
      }
    }
  });

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: readonly unknown[]) => handler(...args));
  }
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function resolveDesktopAgentModelProfile(
  application: DesktopApplication | undefined,
  profileId: string,
  modelNameOverride?: string
) {
  const profiles = await application?.listModelProfiles();
  if (profiles === undefined || !profiles.ok) return undefined;
  const profile = profiles.value.profiles.find((entry) => entry.id === profileId);
  if (profile === undefined) return undefined;
  const modelProfile: LlmModelProfile = {
    id: profile.id,
    provider: profile.provider as LlmProviderId,
    displayName: profile.displayName,
    modelName: modelNameOverride ?? profile.modelName,
    ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
    ...(profile.apiKeyRef.length === 0 ? {} : { apiKeyRef: profile.apiKeyRef }),
    timeoutMs: profile.timeoutMs
  };
  return {
    modelProfile,
    parameters: {
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      ...(profile.topP === undefined ? {} : { topP: profile.topP })
    }
  };
}

async function resolveDesktopAgentModelStartFacts(
  application: DesktopApplication | undefined,
  modelSecretStore: ModelSecretStore,
  profileId: string,
  modelNameOverride?: string
) {
  const profiles = await application?.listModelProfiles();
  if (profiles === undefined || !profiles.ok) return undefined;
  const profile = profiles.value.profiles.find((entry) => entry.id === profileId);
  if (profile === undefined) return undefined;
  const selectedModelName = modelNameOverride?.trim() || profile.modelName;
  const storedSecret =
    profile.apiKeyRef.trim().length === 0
      ? ({ ok: true as const, value: undefined } as const)
      : await modelSecretStore.readSecret(profile.apiKeyRef);
  if (
    profile.provider === "demo" ||
    profile.apiKeyRef.trim().length === 0 ||
    (storedSecret.ok && storedSecret.value === undefined)
  ) {
    const connectionIdentityChecksum = agentModelConnectionIdentityChecksum({
      profileId: profile.id,
      provider: "demo",
      modelName: "desktop-scripted-agent",
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      apiKeyRef: profile.apiKeyRef
    });
    return {
      profileId: profile.id,
      provider: "demo",
      modelName: "desktop-scripted-agent",
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128_000
      },
      requiredContextTokens: 8_000,
      reasoningStrength: reasoningStrengthForModel("demo", "desktop-scripted-agent"),
      connectionIdentityChecksum,
      accountIsolationChecksum: createHash("sha256")
        .update(`demo-account\u0000${profile.id}`, "utf8")
        .digest("hex")
    };
  }

  const discovery = await application?.discoverModelOptions(profileId);
  const discovered =
    discovery !== undefined && discovery.ok
      ? discovery.value.models.find((model) => model.id === selectedModelName)
      : undefined;
  const catalogCapabilities = resolveCatalogAgentModelCapabilities(
    profile.provider,
    selectedModelName
  );
  const contextWindow =
    discovered?.contextWindow !== undefined && discovered.contextWindow > 0
      ? discovered.contextWindow
      : selectedModelName === profile.modelName &&
          profile.contextWindow !== undefined &&
          profile.contextWindow > 0
        ? profile.contextWindow
        : catalogCapabilities?.contextWindow;
  const streaming = discovered?.streaming ?? catalogCapabilities?.streaming;
  const toolCalling = discovered?.toolCalling ?? catalogCapabilities?.toolCalling;
  const structuredArguments =
    discovered?.structuredArguments ?? catalogCapabilities?.structuredArguments;
  const reasoningStrength =
    discovered?.reasoningStrength ??
    (selectedModelName === profile.modelName && discovery !== undefined && discovery.ok
      ? discovery.value.reasoningStrength
      : reasoningStrengthForModel(
          profile.provider,
          selectedModelName,
          profile.baseUrl,
          profile.reasoningEffortEnabled
        ));
  return {
    profileId: profile.id,
    provider: profile.provider,
    modelName: selectedModelName,
    capabilities: {
      ...(streaming === undefined ? {} : { streaming }),
      ...(toolCalling === undefined ? {} : { toolCalling }),
      ...(structuredArguments === undefined ? {} : { structuredArguments }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      promptCache:
        storedSecret.ok && storedSecret.value !== undefined
          ? (catalogCapabilities?.promptCache ?? NO_AGENT_PROMPT_CACHE_CAPABILITY)
          : NO_AGENT_PROMPT_CACHE_CAPABILITY
    },
    requiredContextTokens: 8_000,
    reasoningStrength,
    connectionIdentityChecksum: agentModelConnectionIdentityChecksum({
      profileId: profile.id,
      provider: profile.provider,
      modelName: selectedModelName,
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      apiKeyRef: profile.apiKeyRef
    }),
    accountIsolationChecksum: createHash("sha256")
      .update(
        storedSecret.ok && storedSecret.value !== undefined
          ? `provider-account\u0000${profile.provider}\u0000${storedSecret.value}`
          : `provider-account-unavailable\u0000${profile.id}`,
        "utf8"
      )
      .digest("hex")
  };
}

function agentModelConnectionIdentityChecksum(input: {
  readonly profileId: string;
  readonly provider: string;
  readonly modelName: string;
  readonly baseUrl?: string;
  readonly apiKeyRef: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profileId: input.profileId,
        provider: input.provider.trim().toLowerCase(),
        modelName: input.modelName,
        baseUrl: (input.baseUrl ?? "").trim().replace(/\/+$/u, ""),
        apiKeyRef: input.apiKeyRef
      }),
      "utf8"
    )
    .digest("hex");
}

async function resolveDesktopNetworkRuntime(input: {
  readonly settingsSession: AgentNetworkSettingsSession;
  readonly settingsPort: AgentNetworkSettingsPort;
  readonly modelSecretStore: ModelSecretStore;
}): Promise<{
  readonly executor?: AgentNetworkToolExecutor;
  readonly policyRevision: string;
  readonly dataEgressPolicy: AgentNetworkPolicy["dataEgressPolicy"];
}> {
  const settings = await input.settingsSession.getNetworkSettings();
  if (!settings.ok || !settings.value.enabled || settings.value.allowedHosts.length === 0) {
    return {
      policyRevision: settings.ok ? settings.value.policyRevision : "unavailable",
      dataEgressPolicy: settings.ok ? settings.value.dataEgressPolicy : "require_confirmation"
    };
  }

  const secrets = new Map<string, string>();
  await Promise.all(
    [...new Set(settings.value.providerProfiles.map((profile) => profile.apiKeyRef))].map(
      async (secretRef) => {
        const secret = await input.modelSecretStore.readSecret(secretRef);
        if (secret.ok && secret.value !== undefined) secrets.set(secretRef, secret.value);
      }
    )
  );
  const created = await createDesktopNetworkToolExecutor({
    settingsPort: input.settingsPort,
    resolveSecret: (secretRef) => secrets.get(secretRef)
  });
  return {
    ...(created.ok ? { executor: created.value } : {}),
    policyRevision: settings.value.policyRevision,
    dataEgressPolicy: settings.value.dataEgressPolicy
  };
}

interface DesktopMcpRuntime {
  readonly settingsRevision: string;
  readonly executor?: AgentExternalToolExecutor;
  readonly descriptors?: readonly AgentToolDescriptor[];
  readonly dispose?: () => void;
}

async function resolveDesktopMcpRuntime(input: {
  readonly settingsSession: McpSettingsSession;
  readonly networkSettingsSession: AgentNetworkSettingsSession;
  readonly modelSecretStore: ModelSecretStore;
}): Promise<DesktopMcpRuntime> {
  const [settings, policy] = await Promise.all([
    input.settingsSession.getMcpSettings(),
    input.networkSettingsSession.getEffectivePolicy()
  ]);
  const settingsRevision = settings.ok ? settings.value.revision : "unavailable";
  if (!settings.ok || !policy.ok || !policy.value.enabled) return { settingsRevision };
  const remoteServers = settings.value.servers.filter(isEnabledRemoteMcpServer);
  if (remoteServers.length === 0) return { settingsRevision };

  const secrets = await resolveMcpSecrets(remoteServers, input.modelSecretStore);
  const attempts = await Promise.all(
    remoteServers.map(async (config) =>
      connectRemoteMcp({
        config,
        policy: policy.value,
        resolveApiKey: (secretRef) => secrets.get(secretRef),
        configRevision: settings.value.revision,
        readCurrentConfig: async () =>
          readCurrentRemoteMcpConfig(input.settingsSession, config.serverId)
      })
    )
  );
  const connections = attempts.filter(
    (attempt): attempt is Extract<(typeof attempts)[number], { readonly ok: true }> => attempt.ok
  );
  if (connections.length === 0) return { settingsRevision };

  const advertisedTools = connections.flatMap((connection) => connection.value.tools);
  if (advertisedTools.length > MAX_EXTERNAL_TOOL_DESCRIPTORS) {
    for (const connection of connections) connection.value.close();
    return { settingsRevision };
  }
  const descriptors = createRemoteMcpAgentDescriptors(advertisedTools);
  const valid = validateExternalToolDescriptors(descriptors);
  if (!valid.ok) {
    for (const connection of connections) connection.value.close();
    return { settingsRevision };
  }

  const dispatches = new Map(
    connections.map((connection) => [
      connection.value.serverId,
      createRemoteMcpDispatch(connection.value)
    ])
  );
  const executor = createAgentExternalToolSession({
    dispatch: {
      async callTool(call) {
        const currentPolicy = await input.networkSettingsSession.getEffectivePolicy();
        if (
          !currentPolicy.ok ||
          !currentPolicy.value.enabled ||
          currentPolicy.value.revision !== policy.value.revision
        ) {
          return {
            status: "error" as const,
            error: mcpRuntimeError(
              "MCP_NETWORK_POLICY_CHANGED",
              "Network access changed after this MCP runtime was created."
            )
          };
        }
        const serverId = remoteServerIdForCanonicalTool(call.canonicalToolId);
        const dispatch = serverId === undefined ? undefined : dispatches.get(serverId);
        if (dispatch === undefined) {
          return {
            status: "error" as const,
            error: mcpRuntimeError(
              "MCP_TOOL_NOT_CONFIGURED",
              "The requested remote MCP tool is not part of this trusted runtime snapshot."
            )
          };
        }
        return dispatch.callTool(call);
      }
    }
  });
  return {
    settingsRevision,
    executor,
    descriptors,
    dispose: () => {
      for (const connection of connections) connection.value.close();
    }
  };
}

async function testDesktopRemoteMcpConnection(input: {
  readonly config: McpServerConfig;
  readonly networkSettingsSession: AgentNetworkSettingsSession;
  readonly readMcpSettings: () => Promise<Result<McpSettingsData, UnifiedError>>;
  readonly modelSecretStore: ModelSecretStore;
}): Promise<Result<{ readonly latencyMs: number }, UnifiedError>> {
  if (!isEnabledRemoteMcpServer(input.config)) {
    return err(
      mcpRuntimeError(
        "MCP_TEST_UNAVAILABLE",
        "Only enabled remote HTTP MCP servers can be tested in this build."
      )
    );
  }
  const [policy, settings] = await Promise.all([
    input.networkSettingsSession.getEffectivePolicy(),
    input.readMcpSettings()
  ]);
  if (!policy.ok) return policy;
  if (!settings.ok) return settings;
  const current = settings.value.servers.find(
    (server) => server.serverId === input.config.serverId
  );
  if (!isEnabledRemoteMcpServer(current)) {
    return err(
      mcpRuntimeError("MCP_CONFIG_CHANGED", "The MCP server configuration is no longer current.")
    );
  }
  const secrets = await resolveMcpSecrets([current], input.modelSecretStore);
  const startedAt = Date.now();
  const connected = await connectRemoteMcp({
    config: current,
    policy: policy.value,
    resolveApiKey: (secretRef) => secrets.get(secretRef),
    configRevision: settings.value.revision,
    readCurrentConfig: async () =>
      readCurrentRemoteMcpConfigFromPort(input.readMcpSettings, current.serverId)
  });
  if (!connected.ok) return connected;
  connected.value.close();
  return ok({ latencyMs: Date.now() - startedAt });
}

function isEnabledRemoteMcpServer(
  config: McpServerConfig | undefined
): config is Extract<McpServerConfig, { readonly transport: "remote_http" }> {
  return config?.transport === "remote_http" && config.enabled;
}

async function resolveMcpSecrets(
  configs: readonly Extract<McpServerConfig, { readonly transport: "remote_http" }>[],
  store: ModelSecretStore
): Promise<Map<string, string>> {
  const secrets = new Map<string, string>();
  await Promise.all(
    [...new Set(configs.map((config) => config.apiKeyRef).filter((value) => value.length > 0))].map(
      async (secretRef) => {
        const secret = await store.readSecret(secretRef);
        if (secret.ok && secret.value !== undefined) secrets.set(secretRef, secret.value);
      }
    )
  );
  return secrets;
}

async function readCurrentRemoteMcpConfig(
  settingsSession: McpSettingsSession,
  serverId: string
): Promise<
  Result<{ readonly revision: string; readonly config: McpServerConfig | undefined }, UnifiedError>
> {
  return readCurrentRemoteMcpConfigFromPort(() => settingsSession.getMcpSettings(), serverId);
}

async function readCurrentRemoteMcpConfigFromPort(
  readSettings: () => Promise<Result<McpSettingsData, UnifiedError>>,
  serverId: string
): Promise<
  Result<{ readonly revision: string; readonly config: McpServerConfig | undefined }, UnifiedError>
> {
  const current = await readSettings();
  if (!current.ok) return current;
  return ok({
    revision: current.value.revision,
    config: current.value.servers.find((server) => server.serverId === serverId)
  });
}

function createRemoteMcpAgentDescriptors(
  tools: readonly {
    readonly canonicalId: string;
    readonly serverId: string;
    readonly displayName: string;
    readonly description: string;
    readonly inputSchema: JsonObject;
    readonly effect: "external_action";
    readonly retrySemantics: "never_automatic";
  }[]
): readonly AgentToolDescriptor[] {
  const providerNames = new Set<string>();
  const descriptors: AgentToolDescriptor[] = [];
  for (const tool of [...tools].sort((left, right) =>
    left.canonicalId.localeCompare(right.canonicalId)
  )) {
    if (!isCanonicalRemoteMcpToolId(tool.canonicalId)) continue;
    const canonicalId = tool.canonicalId as NonNullable<AgentToolDescriptor["id"]>;
    const providerName = uniqueMcpProviderName(tool.canonicalId, providerNames);
    const inputSchema = cloneJsonObject(tool.inputSchema);
    const source = Object.freeze({ kind: "mcp" as const, id: tool.serverId });
    const base: Omit<AgentToolDescriptor, "descriptorDigest"> = {
      id: canonicalId,
      name: providerName,
      providerName,
      displayName: tool.displayName,
      description: tool.description,
      kind: "external_tool",
      effect: tool.effect,
      dataEgress: "remote_tool_arguments",
      destructive: false,
      retrySemantics: tool.retrySemantics,
      source,
      inputSchema
    };
    const descriptor: AgentToolDescriptor = Object.freeze({
      ...base,
      source,
      inputSchema: deepFreezeJson(inputSchema),
      descriptorDigest: computeAgentToolDescriptorDigest(base)
    });
    descriptors.push(descriptor);
  }
  return Object.freeze(descriptors);
}

function uniqueMcpProviderName(canonicalId: string, used: Set<string>): string {
  const initial = mangleToolId(canonicalId);
  if (!used.has(initial)) {
    used.add(initial);
    return initial;
  }
  const digest = createHash("sha256").update(canonicalId, "utf8").digest("hex").slice(0, 10);
  const prefix = initial.slice(0, Math.max(1, 64 - digest.length - 1));
  const candidate = `${prefix}_${digest}`;
  if (used.has(candidate)) {
    throw new Error("Remote MCP provider tool names collided after digest mangling.");
  }
  used.add(candidate);
  return candidate;
}

function isCanonicalRemoteMcpToolId(value: string): boolean {
  return /^mcp:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

function remoteServerIdForCanonicalTool(canonicalToolId: string): string | undefined {
  const match = /^mcp:([A-Za-z0-9][A-Za-z0-9._-]{0,63})\//u.exec(canonicalToolId);
  return match?.[1];
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
  return Object.freeze(value);
}

function mcpRuntimeError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the remote MCP and network settings.",
    traceId: "desktop-remote-mcp-runtime"
  });
}

export async function syncSavedEditorForPath(
  application: Pick<DesktopApplication, "readActiveChapterState" | "loadActiveChapter"> | undefined,
  relativePath: string,
  options: { readonly expectedDirtyChecksum?: string } = {}
): Promise<void> {
  const match = /^chapters\/([A-Za-z0-9_-]+)\.md$/.exec(relativePath);
  if (application === undefined || match?.[1] === undefined) return;

  const activeChapter = await application.readActiveChapterState();
  if (activeChapter.ok && activeChapter.value.state.chapter.frontmatter.id === match[1]) {
    if (activeChapter.value.state.dirty) {
      if (options.expectedDirtyChecksum === undefined) {
        throw createUnifiedError({
          code: "AGENT_WRITE_EDITOR_SYNC_DIRTY",
          category: "UserError",
          message: "The active editor changed while Agent changes were being applied.",
          recoverability: "user-action",
          suggestedAction: "Review the preserved editor buffer and transaction recovery status.",
          traceId: "desktop-agent-editor-sync"
        });
      }
      const actualDirtyChecksum = createHash("sha256")
        .update(activeChapter.value.state.chapter.body, "utf8")
        .digest("hex");
      if (actualDirtyChecksum !== options.expectedDirtyChecksum) {
        throw createUnifiedError({
          code: "AGENT_WRITE_EDITOR_SYNC_STALE",
          category: "UserError",
          message: "The active editor changed while Agent changes were being applied.",
          recoverability: "user-action",
          suggestedAction: "Review the preserved editor buffer and transaction recovery status.",
          traceId: "desktop-agent-editor-sync"
        });
      }
    }
    await application.loadActiveChapter();
  }
}

export async function shutdownDesktopApplication(): Promise<void> {
  activeAgentRuntimeManager?.dispose();
  activeAgentRuntimeManager = undefined;
  const modelRuntime = activeDesktopModelRuntime;
  activeDesktopModelRuntime = undefined;
  await modelRuntime?.dispose();
  const application = activeDesktopApplication;
  activeDesktopApplication = undefined;
  if (application !== undefined) {
    await application.shutdown();
  }
}

async function chooseProjectDirectory(title: string): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseProjectTextFile(workspaceRoot: string): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: "Add project file to Agent context",
    defaultPath: workspaceRoot,
    properties: ["openFile"],
    filters: [
      {
        name: "Text and source files",
        extensions: [
          "md",
          "mdx",
          "txt",
          "json",
          "jsonc",
          "yaml",
          "yml",
          "toml",
          "ts",
          "tsx",
          "js",
          "jsx",
          "css",
          "scss",
          "html",
          "xml",
          "py",
          "rs",
          "go",
          "java",
          "c",
          "h",
          "cpp",
          "hpp",
          "cs",
          "sh",
          "ps1"
        ]
      },
      { name: "All files", extensions: ["*"] }
    ]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

export function createMainWindow(): BrowserWindow {
  const preloadPath = join(currentDirectory, "..", "preload", "index.cjs");
  const rendererPath = join(currentDirectory, "..", "renderer", "index.html");

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 720,
    minHeight: 640,
    title: "Novel Studio",
    webPreferences: createSecureWebPreferences(preloadPath)
  });

  void window.loadFile(rendererPath);

  return window;
}

export function setApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate({
        onCommand: (commandId) => {
          const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          if (window !== undefined && !window.isDestroyed()) {
            window.webContents.send("application:menu:native-command", commandId);
          }
        }
      })
    )
  );
}

if (process.env["VITEST"] !== "true") {
  void app.whenReady().then(async () => {
    await registerApplicationIpcHandlers();
    setApplicationMenu();
    createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (shutdownInProgress || activeDesktopApplication === undefined) {
      return;
    }

    event.preventDefault();
    shutdownInProgress = true;
    void shutdownDesktopApplication().finally(() => {
      app.quit();
    });
  });
}
