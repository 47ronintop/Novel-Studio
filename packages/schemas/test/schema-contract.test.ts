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
  "recovery-record"
] as const;

type SchemaName = (typeof schemaNames)[number];

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
});

function expectIssueShape(issue: ValidationIssue): void {
  expect(typeof issue.instancePath).toBe("string");
  expect(typeof issue.schemaPath).toBe("string");
  expect(typeof issue.keyword).toBe("string");
  expect(typeof issue.message).toBe("string");
}
