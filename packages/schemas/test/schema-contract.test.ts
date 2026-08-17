import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STORY_BIBLE_V11_ASSET_TYPES,
  createSchemaValidator,
  createStoryBibleCreateValueSchema,
  createStoryBibleDefaultDetails,
  createStoryBibleV11Schema,
  createStoryBibleWriteCandidateSchema,
  describeStoryBibleType,
  storyBibleSchemaFileName,
  validateStoryBibleV11Asset,
  type StoryBibleV11AssetType,
  type ValidationIssue
} from "../src/index.js";

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

  test("accepts an omitted workspace layout for legacy standalone projects and validates layouts", () => {
    const legacyFixture = readFixture("valid", "project") as Record<string, unknown>;
    const validate = createSchemaValidator(readSchema("project"));

    expect(validate(legacyFixture)).toEqual({ valid: true, issues: [] });
    expect(validate({ ...legacyFixture, workspaceLayout: "standalone" })).toEqual({
      valid: true,
      issues: []
    });
    expect(validate({ ...legacyFixture, workspaceLayout: "nested-folder" })).toEqual({
      valid: true,
      issues: []
    });
    expect(validate({ ...legacyFixture, workspaceLayout: "unsupported" }).valid).toBe(false);
  });

  test.each(STORY_BIBLE_V11_ASSET_TYPES)(
    "keeps generated strict %s schema in sync with the runtime contract",
    (assetType) => {
      const generated = createStoryBibleV11Schema(assetType, "writeStrict");
      const persisted = readJson(
        join(schemaDir, `${storyBibleSchemaFileName(assetType)}.schema.json`)
      );
      const fixture = strictStoryBibleFixture(assetType);

      expect(persisted).toEqual(generated);
      expect(createSchemaValidator(persisted)(fixture)).toEqual({ valid: true, issues: [] });
    }
  );

  test("rejects new unknown Story Bible fields but permits bounded persisted passthrough", () => {
    const fixture = strictStoryBibleFixture("character");
    const unknownRoot = validateStoryBibleV11Asset(
      { ...fixture, futureRootField: true },
      "writeStrict"
    );
    const unknownDetail = validateStoryBibleV11Asset(
      { ...fixture, details: { futureDetailField: true } },
      "writeStrict"
    );
    const passthrough = {
      sourceSchemaVersion: "1.0",
      rootFields: { futureRootField: true },
      detailFieldsByPointer: { "/futureDetailField": { value: true } }
    };

    expect(unknownRoot.valid).toBe(false);
    expect(unknownDetail.valid).toBe(false);
    expect(validateStoryBibleV11Asset({ ...fixture, passthrough }, "writeStrict").valid).toBe(
      false
    );
    expect(validateStoryBibleV11Asset({ ...fixture, passthrough }, "persistedStrict").valid).toBe(
      true
    );
  });

  test.each(STORY_BIBLE_V11_ASSET_TYPES)(
    "derives the %s Agent type description from the strict schemas",
    (assetType) => {
      const description = describeStoryBibleType(assetType);

      expect(description).toMatchObject({
        schemaVersion: "1.1",
        type: assetType,
        createValueSchema: createStoryBibleCreateValueSchema(assetType),
        writeCandidateSchema: createStoryBibleWriteCandidateSchema(assetType),
        systemManagedFields: expect.arrayContaining(["id", "type", "revision", "passthrough"]),
        referenceConstraints: {
          relationSourceMustEqualOwner: true,
          relationTargetMustExist: true,
          arrayIndexPatchAllowed: false
        }
      });
      expect(
        createSchemaValidator(description["createValueSchema"] as Record<string, unknown>)({
          title: "Created by Agent"
        }).valid
      ).toBe(true);
    }
  );

  test("creates characters with a complete mutable current state", () => {
    expect(createStoryBibleDefaultDetails("character")).toEqual({
      currentState: {
        locationId: null,
        physical: "",
        emotional: "",
        heldItemIds: [],
        asOfChapterId: null,
        asOfEventId: null
      },
      knowledgeStates: [],
      stateHistory: []
    });
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

  test("allows a model profile to defer its output-token cap to the provider", () => {
    const fixture = readFixture("valid", "settings") as {
      readonly models: {
        readonly profiles: readonly Record<string, unknown>[];
      };
    };
    const [firstProfile, ...remainingProfiles] = fixture.models.profiles;
    if (firstProfile === undefined) throw new Error("Expected a model profile fixture.");
    const { maxTokens, ...profileWithoutCap } = firstProfile;
    void maxTokens;
    const candidate = {
      ...fixture,
      models: {
        ...fixture.models,
        profiles: [profileWithoutCap, ...remainingProfiles]
      }
    };

    expect(createSchemaValidator(readSchema("settings"))(candidate)).toEqual({
      valid: true,
      issues: []
    });
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

function strictStoryBibleFixture(type: StoryBibleV11AssetType): Record<string, unknown> {
  const ids: Record<StoryBibleV11AssetType, string> = {
    character: "chr_11111111111111111111111111111111",
    "world.location": "loc_11111111111111111111111111111111",
    "world.faction": "fac_11111111111111111111111111111111",
    "world.rule": "rule_11111111111111111111111111111111",
    "world.glossary": "term_11111111111111111111111111111111",
    "world.item": "item_11111111111111111111111111111111",
    "world.lore": "lore_11111111111111111111111111111111",
    outline: "outline_main",
    foreshadow: "fsh_11111111111111111111111111111111",
    "timeline.events": "timeline_main"
  };
  const details: Record<StoryBibleV11AssetType, Record<string, unknown>> = {
    character: {},
    "world.location": {},
    "world.faction": {},
    "world.rule": {},
    "world.glossary": {},
    "world.item": {},
    "world.lore": {},
    outline: { volumes: [], chapterOutlines: [] },
    foreshadow: { trackingStatus: "planned", milestones: [] },
    "timeline.events": { events: [] }
  };
  return {
    schemaVersion: "1.1",
    id: ids[type],
    type,
    title: "Fixture",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: details[type],
    extensions: {},
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    revision: 1
  };
}
