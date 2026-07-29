import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LlmRequest } from "@novel-studio/llm-adapter";
import { afterEach, describe, expect, test } from "vitest";

import { createGeminiPromptCacheResourceManager } from "../src/main/gemini-prompt-cache-resource-manager.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Gemini prompt-cache resource manager", () => {
  test("persists an uncertain create intent before posting a resource", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: (async (input, init) => {
        const call = fetchCall(input, init);
        calls.push(call);
        if (call.method === "POST") {
          expect(await readJournal(root)).toContain('"status": "create_uncertain"');
        }
        return jsonResponse({ name: "cachedContents/cache_intent" });
      }) as typeof fetch
    });

    const resolved = await manager.resolve({
      scopeKey: "standalone",
      request: cacheRequest(),
      apiKey: "key"
    });

    expect(calls.map((call) => call.method)).toEqual(["POST"]);
    expect(resolved).toMatchObject({ resourceRef: "cachedContents/cache_intent" });
    expect(await readJournal(root)).toContain('"status": "active"');
  });

  test("deletes a created resource when its active journal record cannot be persisted", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    let journalWrites = 0;
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: (async (input, init) => {
        const call = fetchCall(input, init);
        calls.push(call);
        if (call.method === "DELETE") return new Response(null, { status: 204 });
        return jsonResponse({ name: "cachedContents/cache_persist_failure" });
      }) as typeof fetch,
      journalWriter: async (path, contents) => {
        journalWrites += 1;
        if (journalWrites === 2) throw new Error("journal unavailable");
        await writeFile(path, contents, "utf8");
      }
    });

    const resolved = await manager.resolve({
      scopeKey: "standalone",
      request: cacheRequest(),
      apiKey: "key"
    });

    expect(resolved).toMatchObject({ bypassReason: "cache_error" });
    expect(resolved).not.toHaveProperty("resourceRef");
    expect(calls.map((call) => call.method)).toEqual(["POST", "DELETE"]);
    const journal = await readJournal(root);
    expect(journal).toContain('"status": "create_uncertain"');
    expect(journal).not.toContain("cachedContents/cache_persist_failure");
  });

  test("creates once, reuses by identity, and deletes on scope release", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: createFetch(calls)
    });
    const request = cacheRequest();

    const created = await manager.resolve({
      scopeKey: "workspace:engineeringWorkspace:workspace_01",
      request,
      apiKey: "private-api-key"
    });
    const reused = await manager.resolve({
      scopeKey: "workspace:engineeringWorkspace:workspace_01",
      request,
      apiKey: "private-api-key"
    });

    expect(created).toMatchObject({
      resourceRef: "cachedContents/cache_1",
      physicalPrefixChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(reused).toEqual(created);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://generativelanguage.googleapis.com/v1beta/cachedContents",
      method: "POST",
      body: {
        model: "models/gemini-1.5-pro",
        contents: [{ role: "user", parts: [{ text: "Stable project context." }] }],
        systemInstruction: { parts: [{ text: "System guidance." }] },
        ttl: "300s"
      }
    });

    const journalBeforeDelete = await readJournal(root);
    expect(journalBeforeDelete).toContain("cachedContents/cache_1");
    expect(journalBeforeDelete).not.toContain("private-api-key");
    expect(journalBeforeDelete).not.toContain("System guidance.");
    expect(journalBeforeDelete).not.toContain("Stable project context.");

    await manager.releaseScope("workspace:engineeringWorkspace:workspace_01");

    expect(calls.at(-1)).toMatchObject({
      url: "https://generativelanguage.googleapis.com/v1beta/cachedContents/cache_1",
      method: "DELETE"
    });
    expect(await readJournal(root)).toContain('"status": "delete_confirmed"');
  });

  test("attributes provider-reported write tokens only to resource creation", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: (async (input, init) => {
        calls.push(fetchCall(input, init));
        return jsonResponse({
          name: "cachedContents/cache_with_usage",
          usageMetadata: { totalTokenCount: 37 }
        });
      }) as typeof fetch
    });
    const input = {
      scopeKey: "standalone",
      request: cacheRequest(),
      apiKey: "key"
    };

    const created = await manager.resolve(input);
    const reused = await manager.resolve(input);

    expect(created).toMatchObject({
      resourceRef: "cachedContents/cache_with_usage",
      resourceWriteTokens: 37
    });
    expect(reused).toMatchObject({ resourceRef: "cachedContents/cache_with_usage" });
    expect(reused).not.toHaveProperty("resourceWriteTokens");
    expect(calls).toHaveLength(1);
  });

  test("deletes an expired resource before creating a replacement", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    let currentTime = "2026-07-29T00:00:00.000Z";
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: createFetch(calls),
      now: () => currentTime
    });
    const request = cacheRequest({ ttlSeconds: 60 });

    await manager.resolve({ scopeKey: "standalone", request, apiKey: "key" });
    currentTime = "2026-07-29T00:02:00.000Z";
    const refreshed = await manager.resolve({
      scopeKey: "standalone",
      request,
      apiKey: "key"
    });

    expect(calls.map((call) => call.method)).toEqual(["POST", "DELETE", "POST"]);
    expect(refreshed?.resourceRef).toBe("cachedContents/cache_2");
  });

  test("falls back without retrying an uncertain create", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: (async (input, init) => {
        calls.push(fetchCall(input, init));
        return new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
      }) as typeof fetch
    });
    const input = { scopeKey: "standalone", request: cacheRequest(), apiKey: "key" };

    const first = await manager.resolve(input);
    const second = await manager.resolve(input);

    expect(first).toMatchObject({ bypassReason: "resource_create_failed" });
    expect(first).not.toHaveProperty("resourceRef");
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(await readJournal(root)).toContain('"status": "create_uncertain"');
  });

  test("records an uncertain delete once and never retries the external side effect", async () => {
    const root = await tempRoot();
    const calls: FetchCall[] = [];
    const manager = createGeminiPromptCacheResourceManager({
      userDataRoot: root,
      fetch: (async (input, init) => {
        const call = fetchCall(input, init);
        calls.push(call);
        if (call.method === "DELETE") throw new TypeError("network unavailable");
        return jsonResponse({ name: "cachedContents/cache_delete_uncertain" });
      }) as typeof fetch
    });
    const input = { scopeKey: "standalone", request: cacheRequest(), apiKey: "key" };

    await manager.resolve(input);
    await manager.releaseScope("standalone");
    await manager.releaseScope("standalone");
    const afterUncertainDelete = await manager.resolve(input);

    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(afterUncertainDelete).toMatchObject({ bypassReason: "resource_unavailable" });
    expect(afterUncertainDelete).not.toHaveProperty("resourceRef");
    expect(await readJournal(root)).toContain('"status": "delete_uncertain"');
  });
});

function cacheRequest(overrides: { readonly ttlSeconds?: number } = {}): LlmRequest {
  return {
    schemaVersion: "1.0",
    requestId: "request_01",
    traceId: "trace_01",
    mode: "streaming",
    modelProfile: {
      id: "profile_gemini",
      provider: "google-gemini",
      displayName: "Gemini",
      modelName: "gemini-1.5-pro",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta"
    },
    messages: [
      { role: "system", content: "System guidance." },
      { role: "user", content: "Stable project context." },
      { role: "user", content: "Dynamic request." }
    ],
    parameters: {},
    promptCache: {
      mode: "explicit_resource",
      policyVersion: "gemini-explicit-resource@1.0",
      identityChecksum: "a".repeat(64),
      logicalPrefixChecksum: "b".repeat(64),
      stablePrefixMessageCount: 2,
      minimumCacheableTokens: 1,
      eligibleInputTokens: 20,
      ttlSeconds: overrides.ttlSeconds ?? 300
    }
  };
}

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

function createFetch(calls: FetchCall[]): typeof fetch {
  let createCount = 0;
  return (async (input, init) => {
    const call = fetchCall(input, init);
    calls.push(call);
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    createCount += 1;
    return jsonResponse({ name: `cachedContents/cache_${String(createCount)}` });
  }) as typeof fetch;
}

function fetchCall(input: URL | RequestInfo, init?: RequestInit): FetchCall {
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  return {
    url: typeof input === "string" ? input : input.toString(),
    method: init?.method ?? "GET",
    headers,
    ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {})
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-gemini-cache-"));
  roots.push(root);
  return root;
}

function readJournal(root: string): Promise<string> {
  return readFile(join(root, "agent", "prompt-cache", "gemini-resources.json"), "utf8");
}
