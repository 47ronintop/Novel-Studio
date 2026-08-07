import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { resolveQualifiedPackagedExecutable } from "./helpers/packaged-agent-approval.js";

describe("packaged Agent approval UI Automation", () => {
  test("binds window lookup to the spawned PID and recognizes both approval locales", async () => {
    const helper = await readFile("apps/desktop/test/helpers/packaged-agent-approval.ts", "utf8");

    expect(helper).toContain('"Review change set"');
    expect(helper).toContain('"审阅变更集"');
    expect(helper).toContain('"Approve change set"');
    expect(helper).toContain('"批准变更集"');
    expect(helper).toContain("ProcessIdProperty");
    expect(helper).toContain("AndCondition");
    expect(helper).toContain("OrCondition");
    expect(helper).toContain("application.processId");
  });

  test("rejects an unsigned package before an E2E process can be spawned", async () => {
    const packageDirectory = await mkdtemp(join(tmpdir(), "novel-studio-unsigned-e2e-"));
    const executable = join(packageDirectory, "Novel Studio.exe");
    const bytes = Buffer.alloc(0x80);
    bytes.write("MZ", 0, "ascii");
    bytes.writeUInt32LE(0x40, 0x3c);
    bytes.write("PE\0\0", 0x40, "ascii");
    await writeFile(executable, bytes);

    try {
      await expect(resolveQualifiedPackagedExecutable(executable)).rejects.toThrow(
        "valid Authenticode signature"
      );
    } finally {
      await rm(packageDirectory, { recursive: true, force: true });
    }
  });
});
