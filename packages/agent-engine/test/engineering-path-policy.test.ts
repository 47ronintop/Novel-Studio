import { describe, expect, test } from "vitest";

import {
  classifyEngineeringPath,
  createEngineeringPathPolicy,
  validateEngineeringRelativePath
} from "../src/index.js";

describe("engineering path policy", () => {
  test("accepts only canonical slash-separated root-relative identities", () => {
    expect(validateEngineeringRelativePath("src/agent/index.ts")).toMatchObject({
      ok: true,
      relativeIdentity: "src/agent/index.ts"
    });
    for (const input of [
      "",
      "/etc/passwd",
      "//server/share/file",
      "\\\\server\\share\\file",
      "C:relative.txt",
      "C:/absolute.txt",
      "src\\index.ts",
      "src//index.ts",
      "src/../index.ts",
      "src/file.txt:stream",
      "src/cafe\u0301.txt"
    ]) {
      const result = validateEngineeringRelativePath(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result).not.toHaveProperty("relativeIdentity");
    }
  });

  test("resolves all matching categories deny-first without exposing matching details on rejection", () => {
    expect(classifyEngineeringPath("src/index.ts")).toMatchObject({
      ok: true,
      classification: "ordinary"
    });
    expect(classifyEngineeringPath(".git/config")).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(classifyEngineeringPath("nested/.GIT/hooks/pre-commit")).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(classifyEngineeringPath("config/.env.production")).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(classifyEngineeringPath("secrets/production/config.ts")).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(classifyEngineeringPath("keys/service.pem")).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(classifyEngineeringPath("AGENTS.md")).toMatchObject({
      ok: true,
      classification: "policy_managed"
    });
    expect(classifyEngineeringPath(".env.example")).toMatchObject({
      ok: true,
      classification: "policy_managed"
    });
    expect(classifyEngineeringPath("node_modules/pkg/index.js")).toMatchObject({
      ok: true,
      classification: "ignored_generated"
    });
    expect(classifyEngineeringPath(".git/node_modules/package.json")).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(classifyEngineeringPath("bad/../secret.txt")).toEqual({
      ok: false,
      code: "invalid_segment"
    });
  });

  test("allows Main-owned ignored additions but cannot use them to downgrade a hard-denied path", () => {
    const policy = createEngineeringPathPolicy({
      ignoredRelativeIdentities: ["generated/schema.ts", ".git/config"],
      ignoredRootNames: ["artifacts"],
      policyManagedLeafNames: ["tooling.lock"]
    });
    expect(policy.ok).toBe(true);
    if (!policy.ok) return;
    expect(classifyEngineeringPath("generated/schema.ts", policy.value)).toMatchObject({
      ok: true,
      classification: "ignored_generated"
    });
    expect(classifyEngineeringPath("artifacts/output.js", policy.value)).toMatchObject({
      ok: true,
      classification: "ignored_generated"
    });
    expect(classifyEngineeringPath("tooling.lock", policy.value)).toMatchObject({
      ok: true,
      classification: "policy_managed"
    });
    expect(classifyEngineeringPath(".git/config", policy.value)).toMatchObject({
      ok: true,
      classification: "hard_denied"
    });
    expect(createEngineeringPathPolicy({ ignoredRootNames: ["bad/name"] })).toEqual({
      ok: false,
      code: "invalid_policy"
    });
  });
});
