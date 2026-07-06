import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(__dirname, "../../..");

const structuralTargets = [
  {
    path: "packages/ui/src/workspace-shell.tsx",
    maxLines: 1200,
    rationale: "UI shell is above the forced split threshold."
  },
  {
    path: "apps/desktop/src/renderer/App.tsx",
    maxLines: 1200,
    rationale: "Renderer composition is above the forced split threshold."
  },
  {
    path: "packages/application/src/ai-writing-workflow-session.ts",
    maxLines: 1000,
    rationale: "Application session is above the forced split threshold."
  }
] as const;

describe("M92 structural refactor gate", () => {
  it.each(structuralTargets)(
    "$path stays below the forced split threshold",
    ({ path, maxLines, rationale }) => {
      const lineCount = readFileSync(resolve(workspaceRoot, path), "utf8").split(/\r?\n/).length;

      expect(lineCount, `${rationale} Current line count: ${lineCount}`).toBeLessThanOrEqual(
        maxLines
      );
    }
  );
});
