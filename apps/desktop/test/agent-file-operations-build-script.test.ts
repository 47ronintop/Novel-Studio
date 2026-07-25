import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

describe("native file operation host staging", () => {
  test("builds only the dedicated host and leaves the staged manifest unavailable", async () => {
    const script = await readFile("scripts/build-agent-file-operations.mjs", "utf8");

    expect(script).toContain('"agent-file-operations-host"');
    expect(script).toContain('status: "unavailable"');
    expect(script).toContain("assertPortableExecutable");
    expect(script).not.toContain('status: "qualified"');
  });

  test("uses a separate resource override rather than the task sandbox bundle", async () => {
    const config = await readFile("apps/desktop/electron-builder.config.cjs", "utf8");

    expect(config).toContain("NOVEL_STUDIO_AGENT_FILE_OPERATIONS_DIR");
    expect(config).toContain('to: "native/agent-file-operations"');
  });

  test("does not expose raw filesystem IPC verbs outside snapshot-bound mutations", async () => {
    const source = await readFile(
      "apps/desktop/native/agent-task-sandbox/file-operations/src/windows_impl.rs",
      "utf8"
    );
    const operationEnum = source.slice(
      source.indexOf("enum Operation"),
      source.indexOf("enum PathSnapshot")
    );

    expect(operationEnum).toContain("before: Vec<PathSnapshot>");
    expect(operationEnum).toContain("after: Vec<PathSnapshot>");
    for (const rawOperation of ["Rename", "Unlink", "Mkdir", "Rmdir", "WriteFile"]) {
      expect(operationEnum).not.toContain(rawOperation);
    }
  });

  test("runs root-identity and reparse qualification vectors without promoting the build manifest", async () => {
    const [qualification, workflow] = await Promise.all([
      readFile("scripts/qualify-agent-file-operations.mjs", "utf8"),
      readFile(".github/workflows/ci.yml", "utf8")
    ]);

    expect(qualification).toContain("ROOT_IDENTITY_MISMATCH");
    expect(qualification).toContain("REPARSE_POINT_REJECTED");
    expect(qualification).toContain("HARDLINK_REJECTED");
    expect(qualification).not.toContain('status: "qualified"');
    expect(workflow).toContain("npm run agent-file-operations:qualify");
  });
});
