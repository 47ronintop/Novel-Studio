import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSchemaValidator, type ValidationIssue } from "@novel-studio/schemas";

const schemaRoots = [
  fileURLToPath(new URL("../../../schemas/schema", import.meta.url)),
  fileURLToPath(new URL("../../schemas/schema", import.meta.url)),
  join(process.cwd(), "packages", "schemas", "schema")
] as const;
const validatorCache = new Map<
  string,
  Promise<ReturnType<typeof createSchemaValidator>>
>();

export async function validateWithSchema(
  schemaName: string,
  data: unknown
): Promise<{ valid: true; issues: [] } | { valid: false; issues: ValidationIssue[] }> {
  const validate = await schemaValidator(schemaName);
  const result = validate(data);

  if (result.valid) {
    return { valid: true, issues: [] };
  }

  return { valid: false, issues: result.issues };
}

function schemaValidator(
  schemaName: string
): Promise<ReturnType<typeof createSchemaValidator>> {
  const cached = validatorCache.get(schemaName);
  if (cached !== undefined) return cached;
  const pending = readSchema(schemaName).then((schemaText) =>
    createSchemaValidator(JSON.parse(schemaText))
  );
  validatorCache.set(schemaName, pending);
  void pending.catch(() => {
    if (validatorCache.get(schemaName) === pending) validatorCache.delete(schemaName);
  });
  return pending;
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
