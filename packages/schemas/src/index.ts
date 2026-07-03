import { createRequire } from "node:module";
import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv/dist/ajv.js";
import type { FormatsPlugin } from "ajv-formats";

const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;

export interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type SchemaValidator = (data: unknown) => ValidationResult;

export function createSchemaValidator(schema: unknown): SchemaValidator {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    removeAdditional: false
  });
  addFormats(ajv);

  const validate = ajv.compile(schema as AnySchema);

  return (data: unknown): ValidationResult => {
    const validationResult = validate(data);
    if (typeof validationResult !== "boolean") {
      throw new Error("Async JSON Schema validation is not supported for project contracts");
    }

    return {
      valid: validationResult,
      issues: validationResult ? [] : mapIssues(validate)
    };
  };
}

function mapIssues(validate: ValidateFunction): ValidationIssue[] {
  return (validate.errors ?? []).map((error: ErrorObject): ValidationIssue => {
    return {
      instancePath: error.instancePath,
      schemaPath: error.schemaPath,
      keyword: error.keyword,
      message: error.message ?? "Schema validation failed"
    };
  });
}
