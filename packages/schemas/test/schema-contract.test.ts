import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSchemaValidator, type ValidationIssue } from "../src/index.js";

const rootDir = process.cwd();
const schemaDir = join(rootDir, "packages", "schemas", "schema");
const validFixtureDir = join(rootDir, "fixtures", "schemas", "valid");
const invalidFixtureDir = join(rootDir, "fixtures", "schemas", "invalid");

const schemaNames = [
  "project",
  "settings",
  "chapter-frontmatter",
  "unified-error",
  "story-asset",
  "foreshadow",
  "prompt-template",
  "agent-config",
  "workflow-definition",
  "memory",
  "context-bundle",
  "agent-handoff",
  "llm-request",
  "llm-response",
  "version-record",
  "recovery-record",
  "release-channel",
  "plugin-manifest",
  "plugin-registry",
  "search-index",
  "workflow-run-record"
] as const;

type SchemaName = (typeof schemaNames)[number];

const requiredModelProviders = [
  "openai-compatible",
  "openai",
  "anthropic",
  "google-gemini",
  "openrouter",
  "deepseek",
  "zhipu",
  "tongyi-qianwen",
  "ollama",
  "lm-studio",
  "vllm"
] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readSchema(name: SchemaName): unknown {
  return readJson(join(schemaDir, `${name}.schema.json`));
}

function readFixture(kind: "valid" | "invalid", name: SchemaName): unknown {
  const baseDir = kind === "valid" ? validFixtureDir : invalidFixtureDir;
  return readJson(join(baseDir, `${name}.json`));
}

describe("schema contract coverage", () => {
  test("has a schema and valid/invalid fixture for every required M2 contract", () => {
    const schemaFiles = new Set(readdirSync(schemaDir));
    const validFiles = new Set(readdirSync(validFixtureDir));
    const invalidFiles = new Set(readdirSync(invalidFixtureDir));

    for (const name of schemaNames) {
      expect(schemaFiles.has(`${name}.schema.json`), `missing schema for ${name}`).toBe(true);
      expect(validFiles.has(`${name}.json`), `missing valid fixture for ${name}`).toBe(true);
      expect(invalidFiles.has(`${name}.json`), `missing invalid fixture for ${name}`).toBe(true);
    }
  });

  test.each(schemaNames)("accepts valid %s fixture", (name) => {
    const validate = createSchemaValidator(readSchema(name));
    const result = validate(readFixture("valid", name));

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test.each(schemaNames)("rejects invalid %s fixture with stable issue data", (name) => {
    const validate = createSchemaValidator(readSchema(name));
    const result = validate(readFixture("invalid", name));

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expectIssueShape(issue);
    }
  });

  test("accepts foreshadow entries without changing the search index schema version", () => {
    const legacyFixture = readFixture("valid", "search-index") as {
      readonly schemaVersion: "1.0";
      readonly generatedAt: string;
      readonly entryCount: number;
      readonly entries: readonly unknown[];
    };
    const fixture = {
      ...legacyFixture,
      entryCount: legacyFixture.entryCount + 1,
      entries: [
        ...legacyFixture.entries,
        {
          id: "story.foreshadow:fsh_018f12a7b91c4a2f9437c3d764e9a120",
          type: "story.foreshadow",
          title: "旧钥匙的来源",
          text: "第一章出现的旧钥匙将在第五章揭示来源。",
          updatedAt: "2026-07-29T00:00:00.000Z",
          sourceRef: {
            kind: "story-asset",
            id: "fsh_018f12a7b91c4a2f9437c3d764e9a120",
            relativePath: "foreshadows/fsh_018f12a7b91c4a2f9437c3d764e9a120.json"
          }
        }
      ]
    };
    const validate = createSchemaValidator(readSchema("search-index"));

    expect(fixture.schemaVersion).toBe("1.0");
    expect(validate(legacyFixture)).toEqual({ valid: true, issues: [] });
    expect(validate(fixture)).toEqual({ valid: true, issues: [] });
  });

  test("preserves unknown fields by default after validation", () => {
    const fixture = {
      schemaVersion: "1.0",
      projectId: "prj_unknown_field",
      title: "Unknown Field Project",
      projectType: "novel",
      language: "zh-CN",
      createdAt: "2026-07-03T00:00:00.000Z",
      updatedAt: "2026-07-03T00:00:00.000Z",
      experimentalUserField: "must stay"
    };
    const validate = createSchemaValidator(readSchema("project"));

    const result = validate(fixture);

    expect(result.valid).toBe(true);
    expect(fixture.experimentalUserField).toBe("must stay");
  });

  test.each([
    ["missing tracking status", { sourceRefs: [] }],
    [
      "invalid chapter id",
      {
        trackingStatus: "planted",
        plantedChapterId: "chapter-01"
      }
    ],
    [
      "invalid evidence hash",
      {
        trackingStatus: "planted",
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: "旧钥匙再次出现。",
            excerptHash: "not-a-sha256-hash"
          }
        ]
      }
    ],
    [
      "empty evidence excerpt",
      {
        trackingStatus: "planted",
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: "",
            excerptHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
          }
        ]
      }
    ],
    ["paid-off without actual chapter", { trackingStatus: "paid-off" }]
  ])("rejects foreshadow details with %s", (_caseName, details) => {
    const fixture = {
      ...(readFixture("valid", "foreshadow") as Record<string, unknown>),
      details
    };
    const validate = createSchemaValidator(readSchema("foreshadow"));

    expect(validate(fixture).valid).toBe(false);
  });

  test("accepts foreshadow unknown fields without removing them", () => {
    const fixture = {
      ...(readFixture("valid", "foreshadow") as Record<string, unknown>),
      futureRootField: "preserve root",
      details: {
        trackingStatus: "planted",
        futureDetailsField: "preserve details",
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: "旧钥匙再次出现。",
            excerptHash: "32d8d8ac4a08a7f8db7a10c1d21e71a5ab31277b9c88d09a5b91665687565690",
            futureSourceField: "preserve source"
          }
        ]
      }
    };
    const validate = createSchemaValidator(readSchema("foreshadow"));

    expect(validate(fixture)).toEqual({ valid: true, issues: [] });
    expect(fixture.futureRootField).toBe("preserve root");
    expect(fixture.details.futureDetailsField).toBe("preserve details");
    expect(fixture.details.sourceRefs[0]?.futureSourceField).toBe("preserve source");
  });

  test("settings model profiles reject plaintext keys and unsupported providers", () => {
    const fixture = {
      schemaVersion: "1.0",
      autosave: {
        enabled: true,
        intervalMs: 30000
      },
      history: {
        snapshotPolicy: "manual-and-interval"
      },
      models: {
        defaultProfileId: "model_plaintext",
        profiles: [
          {
            id: "model_plaintext",
            provider: "unsupported-provider",
            displayName: "Plaintext Model",
            baseUrl: "https://api.example.com/v1",
            apiKeyRef: "secret://model_plaintext/api_key",
            apiKey: "sk-secret",
            modelName: "example-model",
            temperature: 0.7,
            maxTokens: 4096,
            timeoutMs: 60000
          }
        ]
      }
    };
    const validate = createSchemaValidator(readSchema("settings"));

    const result = validate(fixture);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.instancePath)).toEqual(
      expect.arrayContaining(["/models/profiles/0/provider", "/models/profiles/0/apiKey"])
    );
  });

  test("settings valid fixture covers every constitution-required model provider", () => {
    const fixture = readFixture("valid", "settings") as {
      readonly models?: {
        readonly profiles?: readonly {
          readonly provider?: string;
        }[];
      };
    };

    const providers = new Set(
      fixture.models?.profiles?.map((profile) => profile.provider).filter(Boolean)
    );

    expect([...providers].sort()).toEqual([...requiredModelProviders].sort());
  });

  test("accepts a plugin manifest with a tools contribution", () => {
    const fixture = {
      ...(readFixture("valid", "plugin-manifest") as Record<string, unknown>),
      capabilities: [
        {
          type: "command",
          id: "test-tools.open-character-map",
          title: "Open Character Map"
        },
        {
          type: "tool",
          id: "test-tools.summarise",
          title: "Summarise Chapter"
        }
      ],
      permissions: [
        { permission: "asset:read", scopes: ["characters"] },
        { permission: "tool:invoke", scopes: ["project"] }
      ],
      contributes: {
        commands: [{ id: "test-tools.open-character-map", title: "Open Character Map" }],
        workflowSteps: [],
        tools: [
          {
            id: "test-tools.summarise",
            title: "Summarise Chapter",
            description: "Summarises the active chapter into a short synopsis.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                chapterId: { type: "string" }
              },
              required: ["chapterId"]
            },
            timeoutMs: 5000,
            maxOutputBytes: 65536
          }
        ]
      }
    };
    const validate = createSchemaValidator(readSchema("plugin-manifest"));

    const result = validate(fixture);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("accepts a plugin manifest that omits contributes.tools for backward compatibility", () => {
    const fixture = readFixture("valid", "plugin-manifest") as Record<string, unknown>;
    expect((fixture["contributes"] as Record<string, unknown>)["tools"]).toBeUndefined();

    const validate = createSchemaValidator(readSchema("plugin-manifest"));
    const result = validate(fixture);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("rejects a plugin manifest tool schema that uses $ref", () => {
    const fixture = {
      ...(readFixture("valid", "plugin-manifest") as Record<string, unknown>),
      contributes: {
        commands: [],
        workflowSteps: [],
        tools: [
          {
            id: "test-tools.summarise",
            title: "Summarise Chapter",
            description: "Summarises the active chapter into a short synopsis.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              $ref: "#/definitions/summariseInput"
            }
          }
        ]
      }
    };
    const validate = createSchemaValidator(readSchema("plugin-manifest"));

    const result = validate(fixture);

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test("rejects a plugin manifest tool schema missing additionalProperties: false", () => {
    const fixture = {
      ...(readFixture("valid", "plugin-manifest") as Record<string, unknown>),
      contributes: {
        commands: [],
        workflowSteps: [],
        tools: [
          {
            id: "test-tools.summarise",
            title: "Summarise Chapter",
            description: "Summarises the active chapter into a short synopsis.",
            inputSchema: {
              type: "object"
            }
          }
        ]
      }
    };
    const validate = createSchemaValidator(readSchema("plugin-manifest"));

    const result = validate(fixture);

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test("workflow valid fixture covers branch step metadata", () => {
    const fixture = readFixture("valid", "workflow-definition") as {
      readonly steps?: readonly {
        readonly kind?: string;
        readonly branches?: readonly {
          readonly id?: string;
          readonly label?: string;
          readonly condition?: string;
          readonly nextStepId?: string;
        }[];
        readonly defaultNextStepId?: string;
      }[];
    };

    const branchStep = fixture.steps?.find((step) => step.kind === "branch");

    expect(branchStep?.branches).toEqual([
      {
        id: "needs_revision",
        label: "Needs revision",
        condition: "review.severity >= medium",
        nextStepId: "step_rewrite"
      },
      {
        id: "ready_to_save",
        label: "Ready to save",
        condition: "review.severity < medium",
        nextStepId: "step_save"
      }
    ]);
    expect(branchStep?.defaultNextStepId).toBe("step_save");
  });
});

function expectIssueShape(issue: ValidationIssue): void {
  expect(typeof issue.instancePath).toBe("string");
  expect(typeof issue.schemaPath).toBe("string");
  expect(typeof issue.keyword).toBe("string");
  expect(typeof issue.message).toBe("string");
}
