import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);

interface ElectronBuilderConfig {
  readonly artifactName?: string;
  readonly directories?: {
    readonly output?: string;
    readonly buildResources?: string;
  };
  readonly win?: {
    readonly icon?: string;
    readonly target?: ReadonlyArray<string | { readonly target: string }>;
    readonly forceCodeSigning?: boolean;
  };
  readonly nsis?: {
    readonly oneClick?: boolean;
    readonly perMachine?: boolean;
    readonly allowToChangeInstallationDirectory?: boolean;
    readonly createDesktopShortcut?: boolean;
    readonly createStartMenuShortcut?: boolean;
    readonly shortcutName?: string;
  };
}

interface PackageJson {
  readonly scripts: Record<string, string>;
}

describe("M17 installer and release channel", () => {
  test("declares installer, release notes, and release check scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;

    expect(packageJson.scripts["package:installer"]).toBe("node scripts/package-installer.mjs");
    expect(packageJson.scripts["release:notes"]).toBe("node scripts/release-notes.mjs");
    expect(packageJson.scripts["release:check"]).toBe("node scripts/release-check.mjs");
  });

  test("configures Windows NSIS installer output without requiring signing in CI", () => {
    const config = require("../electron-builder.config.cjs") as ElectronBuilderConfig;
    const targets = new Set(
      (config.win?.target ?? []).map((target) =>
        typeof target === "string" ? target : target.target
      )
    );

    expect(targets.has("dir")).toBe(true);
    expect(targets.has("nsis")).toBe(true);
    expect(config.artifactName).toBe("Novel-Studio-${version}-${os}-${arch}.${ext}");
    expect(config.directories?.buildResources).toBe("apps/desktop/build");
    expect(config.win?.icon).toBe("apps/desktop/build/icon.svg");
    expect(config.win?.forceCodeSigning).toBe(false);
    expect(config.nsis?.oneClick).toBe(false);
    expect(config.nsis?.perMachine).toBe(false);
    expect(config.nsis?.allowToChangeInstallationDirectory).toBe(true);
    expect(config.nsis?.createDesktopShortcut).toBe(true);
    expect(config.nsis?.createStartMenuShortcut).toBe(true);
    expect(config.nsis?.shortcutName).toBe("Novel Studio");
    expect(existsSync(join(process.cwd(), "apps", "desktop", "build", "icon.svg"))).toBe(true);
  });

  test("defines a local beta release channel manifest and notes", () => {
    const manifest = JSON.parse(readFileSync("release-channel/beta.json", "utf8")) as {
      readonly schemaVersion: string;
      readonly channel: string;
      readonly publishMode: string;
      readonly releaseNotesPath: string;
      readonly signing: {
        readonly policy: string;
        readonly required: boolean;
      };
    };

    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.channel).toBe("beta");
    expect(manifest.publishMode).toBe("manual");
    expect(manifest.releaseNotesPath).toBe("docs/releases/v0.1.0-beta.md");
    expect(manifest.signing.required).toBe(false);
    expect(manifest.signing.policy).toBe("unsigned-local-beta");
    expect(readFileSync(manifest.releaseNotesPath, "utf8")).toContain("M17 安装器与发布通道");
    expect(readFileSync(manifest.releaseNotesPath, "utf8")).toContain("M18 插件系统边界");
  });

  test("release check validates the local M17 publishing contract", () => {
    const result = spawnSync("npm run release:check", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Release check passed");
  });
});
