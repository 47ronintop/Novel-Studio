import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSchemaValidator, type ValidationIssue } from "@novel-studio/schemas";

const schemaRoot = join(process.cwd(), "packages", "schemas", "schema");

export async function validateWithSchema(
  schemaName: string,
  data: unknown
): Promise<{ valid: true; issues: [] } | { valid: false; issues: ValidationIssue[] }> {
  const schemaText = await readFile(join(schemaRoot, `${schemaName}.schema.json`), "utf8");
  const validate = createSchemaValidator(JSON.parse(schemaText));
  const result = validate(data);

  if (result.valid) {
    return { valid: true, issues: [] };
  }

  return { valid: false, issues: result.issues };
}
