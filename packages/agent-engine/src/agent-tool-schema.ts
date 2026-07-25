/**
 * Task 0.1 — Strict JSON Schema subset validator for Agent tool descriptors.
 * Rejects unknown keywords, remote $ref, recursive references, dangerous regex patterns,
 * and enforces byte/depth budgets so dynamic tool schemas cannot exhaust context.
 */
import type { JsonObject } from "@novel-studio/shared";

/** Hard limits for a single tool descriptor's schema and metadata. */
export const TOOL_SCHEMA_MAX_BYTES = 16_384;
export const TOOL_DESCRIPTION_MAX_BYTES = 2_048;
export const TOOL_DISPLAY_NAME_MAX_BYTES = 256;
export const TOOL_SCHEMA_MAX_DEPTH = 8;
export const TOOL_SCHEMA_MAX_PROPERTIES = 64;
export const TOOL_SCHEMA_MAX_ENUM_VALUES = 128;
export const TOOL_SCHEMA_MAX_COMBINATION_BRANCHES = 8;

/** Total tool-directory byte budget per run (schema + description + name for all tools). */
export const TOOL_DIRECTORY_MAX_TOTAL_BYTES = 262_144;

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "additionalProperties",
  "required",
  "items",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "enum",
  "const",
  "description",
  "title",
  "default",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else"
]);

/**
 * Dangerous regex patterns that can cause catastrophic backtracking.
 * Detects (x+)+ / (x+)* / (x*)* style nested quantifier patterns.
 */
function isDangerousRegex(pattern: string): SchemaValidationResult {
  // Detect group-followed-by-quantifier where group contains a quantifier:
  // e.g. (a+)+, (a*)+, (.*)+ etc.
  // Walk the string to find group spans, then check for outer quantifier.
  const len = pattern.length;
  for (let i = 0; i < len; i++) {
    if (pattern[i] !== "(") continue;
    // Find the matching closing paren (simplified: no nested groups)
    let depth = 0;
    let innerHasQuantifier = false;
    let closeIdx = -1;
    for (let j = i; j < len; j++) {
      if (pattern[j] === "(") depth++;
      else if (pattern[j] === ")") {
        depth--;
        if (depth === 0) {
          closeIdx = j;
          break;
        }
      } else if ((pattern[j] === "+" || pattern[j] === "*") && depth === 1) {
        innerHasQuantifier = true;
      }
    }
    if (closeIdx !== -1 && innerHasQuantifier) {
      // Check if the group itself is followed by + or *
      const nextCh = pattern[closeIdx + 1];
      if (nextCh === "+" || nextCh === "*") {
        return {
          ok: false,
          reason: `Potentially catastrophic regex pattern detected: "${pattern}".`
        };
      }
    }
  }

  // Check for unbounded {n,} repetition
  for (let i = 0; i < len - 1; i++) {
    if (pattern[i] === "{") {
      const close = pattern.indexOf("}", i + 1);
      if (close !== -1) {
        const inside = pattern.slice(i + 1, close);
        if (/^[0-9]+,$/.test(inside)) {
          return { ok: false, reason: `Unbounded repetition quantifier in pattern: "${pattern}".` };
        }
      }
    }
  }

  // Multiple .* is also problematic
  let dotStarCount = 0;
  for (let i = 0; i < len - 1; i++) {
    if (pattern[i] === "." && pattern[i + 1] === "*") {
      dotStarCount++;
      if (dotStarCount >= 2) {
        return {
          ok: false,
          reason: `Multiple .* in pattern may cause catastrophic backtracking: "${pattern}".`
        };
      }
    }
  }

  return { ok: true };
}

export type SchemaValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Validate a JSON Schema object against the strict subset allowed for Agent tools.
 * Returns `{ ok: false, reason }` for any violation; `{ ok: true }` when safe.
 */
export function validateStrictToolSchema(schema: unknown): SchemaValidationResult {
  const bytes = JSON.stringify(schema).length;
  if (bytes > TOOL_SCHEMA_MAX_BYTES) {
    return {
      ok: false,
      reason: `Schema exceeds ${TOOL_SCHEMA_MAX_BYTES} byte limit (${bytes} bytes).`
    };
  }
  return validateSchemaNode(schema, 0, new Set());
}

function validateSchemaNode(
  node: unknown,
  depth: number,
  seen: Set<unknown>
): SchemaValidationResult {
  if (depth > TOOL_SCHEMA_MAX_DEPTH) {
    return { ok: false, reason: `Schema nesting exceeds ${TOOL_SCHEMA_MAX_DEPTH} levels.` };
  }
  if (!isObject(node)) return { ok: true };
  if (seen.has(node)) {
    return { ok: false, reason: "Schema contains a recursive reference." };
  }
  seen.add(node);

  for (const key of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) {
      return { ok: false, reason: `Unknown schema keyword: "${key}".` };
    }
  }

  if ("$ref" in node) {
    return { ok: false, reason: "Remote $ref is not allowed in tool schemas." };
  }

  const properties = node["properties"];
  if (isObject(properties)) {
    const propCount = Object.keys(properties).length;
    if (propCount > TOOL_SCHEMA_MAX_PROPERTIES) {
      return {
        ok: false,
        reason: `Schema has ${propCount} properties; limit is ${TOOL_SCHEMA_MAX_PROPERTIES}.`
      };
    }
    for (const [, propSchema] of Object.entries(properties)) {
      const result = validateSchemaNode(propSchema, depth + 1, seen);
      if (!result.ok) return result;
    }
  }

  const items = node["items"];
  if (items !== undefined && items !== false) {
    const result = validateSchemaNode(items, depth + 1, seen);
    if (!result.ok) return result;
  }

  const pattern = node["pattern"];
  if (typeof pattern === "string") {
    const dangerousCheck = isDangerousRegex(pattern);
    if (!dangerousCheck.ok) return dangerousCheck;
    try {
      new RegExp(pattern);
    } catch {
      return { ok: false, reason: `Invalid regex pattern: "${pattern}".` };
    }
  }

  const enumValues = node["enum"];
  if (Array.isArray(enumValues)) {
    if (enumValues.length > TOOL_SCHEMA_MAX_ENUM_VALUES) {
      return {
        ok: false,
        reason: `Enum has ${enumValues.length} values; limit is ${TOOL_SCHEMA_MAX_ENUM_VALUES}.`
      };
    }
  }

  for (const combineKey of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = node[combineKey];
    if (Array.isArray(branches)) {
      if (branches.length > TOOL_SCHEMA_MAX_COMBINATION_BRANCHES) {
        return {
          ok: false,
          reason: `${combineKey} has ${branches.length} branches; limit is ${TOOL_SCHEMA_MAX_COMBINATION_BRANCHES}.`
        };
      }
      for (const branch of branches) {
        const result = validateSchemaNode(branch, depth + 1, seen);
        if (!result.ok) return result;
      }
    }
  }

  for (const condKey of ["if", "then", "else", "not"] as const) {
    if (node[condKey] !== undefined) {
      const result = validateSchemaNode(node[condKey], depth + 1, seen);
      if (!result.ok) return result;
    }
  }

  return { ok: true };
}

/** Returns true if the text contains disallowed C0/C1 control characters (except tab, LF, CR). */
function hasDisallowedControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Allow tab (9), LF (10), CR (13); block all other C0 (0-31) and DEL (127)
    if (code <= 31 && code !== 9 && code !== 10 && code !== 13) return true;
    if (code === 127) return true;
  }
  return false;
}

/** Validate tool description/name text: enforces length and rejects disallowed control chars. */
export function validateToolText(
  text: string,
  maxBytes: number,
  field: string
): SchemaValidationResult {
  if (hasDisallowedControlChars(text)) {
    return { ok: false, reason: `${field} contains disallowed control characters.` };
  }
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    return { ok: false, reason: `${field} exceeds ${maxBytes} byte limit (${bytes} bytes).` };
  }
  return { ok: true };
}

/** Compute total directory bytes for a set of tool descriptors (schema + description + names). */
export function computeToolDirectoryBytes(
  tools: readonly {
    readonly inputSchema: JsonObject;
    readonly description?: string;
    readonly displayName?: string;
    readonly providerName?: string;
    readonly name: string;
  }[]
): number {
  return tools.reduce((sum, tool) => {
    const providerName = tool.providerName ?? tool.name;
    return (
      sum +
      JSON.stringify(tool.inputSchema).length +
      (tool.description !== undefined ? new TextEncoder().encode(tool.description).byteLength : 0) +
      (tool.displayName !== undefined ? new TextEncoder().encode(tool.displayName).byteLength : 0) +
      new TextEncoder().encode(providerName).byteLength
    );
  }, 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
