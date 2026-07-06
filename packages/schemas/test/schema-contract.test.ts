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
