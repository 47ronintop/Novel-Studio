import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { AiWritingSuggestion } from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import {
  createDesktopModelRuntime,
  createEncryptedFileModelSecretStore,
  type DesktopSecretCipher
} from "../src/main/model-runtime.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const tempRoots: string[] = [];
const apiKeyRef = "secret://model_deepseek/api_key";

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M95 real provider runtime", () => {
  test("stores model API keys as encrypted secret material instead of settings plaintext", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-secrets-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });

    const saved = await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    expect(saved).toEqual({ ok: true, value: undefined });

    const secretFile = await readFile(join(userDataRoot, "secrets", "model-secrets.json"), "utf8");
    expect(secretFile).toContain(apiKeyRef);
    expect(secretFile).not.toContain("sk-real-deepseek-key");

    const restored = await secretStore.readSecret(apiKeyRef);
    expect(restored).toEqual({ ok: true, value: "sk-real-deepseek-key" });
  });

  test("tests model connections by sending a real OpenAI-compatible request with the stored key", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-runtime-test-"));
    tempRoots.push(userDataRoot);
    const calls: FetchCall[] = [];
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createJsonFetch(calls, {
        id: "chatcmpl_test",
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    });

    const tested = await runtime.modelConnectionTester.testConnection(createDeepSeekProfile());

    expect(tested).toMatchObject({
      ok: true,
      value: {
        ok: true,
        provider: "deepseek",
        modelName: "deepseek-chat"
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer sk-real-deepseek-key"
    });
    expect(calls[0]?.body).toMatchObject({
      model: "deepseek-chat",
      stream: false
    });
    const verified = await secretStore.isVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    expect(verified).toEqual({ ok: true, value: true });
  });

  test("reports non-JSON provider responses as actionable Base URL errors", async () => {
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-runtime-html-"));
    tempRoots.push(userDataRoot);
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: (async () =>
        new Response("<!doctype html><html><body>Wrong endpoint</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })) as typeof fetch
    });

    const tested = await runtime.modelConnectionTester.testConnection(createDeepSeekProfile());

    expect(tested).toMatchObject({
      ok: true,
      value: {
        ok: false,
        provider: "deepseek",
        modelName: "deepseek-chat",
        detail: expect.stringContaining("non-JSON response")
      }
    });
    expect(JSON.stringify(tested)).not.toContain("Unexpected token");
  });

  test("routes default AI suggestions through the real provider after the profile key is verified", async () => {
    const projectRoot = await copyDeepSeekProject();
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-real-provider-"));
    tempRoots.push(userDataRoot);
    const calls: FetchCall[] = [];
    const secretStore = createEncryptedFileModelSecretStore({
      userDataRoot,
      cipher: testCipher
    });
    await secretStore.saveSecret(apiKeyRef, "sk-real-deepseek-key");
    await secretStore.markVerified(apiKeyRef, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat"
    });
    const runtime = createDesktopModelRuntime({
      userDataRoot,
      secretStore,
      fetch: createJsonFetch(calls, {
        id: "chatcmpl_real",
        choices: [
          {
            message: {
              content: JSON.stringify({
                proposedBody: "Real provider continuation.\n",
                summary: "Returned by the configured DeepSeek provider."
              })
            }
          }
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
      })
    });
    const application = createProjectDesktopApplication({
      projectRoot,
      userDataRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => "2026-07-07T00:00:00.000Z",
      modelConnectionTester: runtime.modelConnectionTester,
      createAiProvider: runtime.createAiProvider
    });
    const loaded = await application.loadActiveChapter();
    assertOk(loaded);

    const generated = await application.generateActiveChapterSuggestion({
      instruction: "Continue through real provider."
    });

    assertOk<AiWritingSuggestion>(generated);
    expect(generated.value.summary).toBe("Returned by the configured DeepSeek provider.");
    expect(generated.value.observability.model.provider).toBe("deepseek");
    expect(generated.value.proposedBody).not.toContain("AI continuation draft.");
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer sk-real-deepseek-key"
    });
  });
});

const testCipher: DesktopSecretCipher = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    return Buffer.from(`encrypted:${value}`, "utf8");
  },
  decryptString(value) {
    return value.toString("utf8").replace(/^encrypted:/, "");
  }
};

interface FetchCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function createJsonFetch(calls: FetchCall[], payload: unknown): typeof fetch {
  return (async (url, init) => {
    const headers = normalizeHeaders(init?.headers);
    calls.push({
      url: String(url),
      headers,
      body: JSON.parse(String(init?.body ?? "{}")) as unknown
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries([...headers.entries()]);
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]));
  }
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

function createDeepSeekProfile() {
  return {
    id: "model_deepseek",
    provider: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyRef,
    modelName: "deepseek-chat",
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1,
    timeoutMs: 60000
  };
}

async function copyDeepSeekProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-m95-real-provider-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        autosave: { enabled: true, intervalMs: 30000, createHistorySnapshot: false },
        history: {
          snapshotPolicy: "manual-and-interval",
          intervalMinutes: 10,
          maxSnapshotsPerChapter: 20
        },
        models: {
          defaultProfileId: "model_deepseek",
          profiles: [createDeepSeekProfile()]
        }
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    join(target, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );

  return target;
}

function assertOk<T>(
  result: unknown
): asserts result is Result<T, UnifiedError> & { readonly ok: true } {
  expect(result).toMatchObject({ ok: true });
}
