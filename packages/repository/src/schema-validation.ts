import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchemaValidator, type ValidationIssue } from "@novel-studio/schemas";

const schemaRoots = [
  fileURLToPath(new URL("../../../schemas/schema", import.meta.url)),
  fileURLToPath(new URL("../../schemas/schema", import.meta.url)),
  join(process.cwd(), "packages", "schemas", "schema")
] as const;

export async function validateWithSchema(
  schemaName: string,
  data: unknown
): Promise<{ valid: true; issues: [] } | { valid: false; issues: ValidationIssue[] }> {
  const schemaText = await readSchema(schemaName);
  const validate = createSchemaValidator(JSON.parse(schemaText));
  const result = validate(data);

  if (result.valid) {
    return { valid: true, issues: [] };
  }

  return { valid: false, issues: result.issues };
}

async function readSchema(schemaName: string): Promise<string> {
  const fileName = `${schemaName}.schema.json`;
  let lastError: unknown;

  for (const schemaRoot of schemaRoots) {
    try {
      return await readFile(join(schemaRoot, fileName), "utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Schema file could not be read: ${fileName}`);
}
