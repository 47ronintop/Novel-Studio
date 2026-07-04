import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { ChapterEditor, WorkspaceShell } from "@novel-studio/ui";

const chapter = {
  frontmatter: {
    schemaVersion: "1.0" as const,
    id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
    type: "chapter" as const,
    title: "Chapter One",
    order: 1,
    status: "draft" as const,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "Opening paragraph.\n"
};

describe("M9 accessibility hardening", () => {
  test("exposes a deterministic keyboard focus order through the workspace shell", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain('data-focus-order="1"');
    expect(html).toContain('data-focus-order="2"');
    expect(html).toContain('data-focus-order="3"');
    expect(html).toContain('data-focus-order="4"');
    expect(html.indexOf('data-focus-order="1"')).toBeLessThan(html.indexOf('data-focus-order="2"'));
    expect(html.indexOf('data-focus-order="2"')).toBeLessThan(html.indexOf('data-focus-order="3"'));
    expect(html.indexOf('data-focus-order="3"')).toBeLessThan(html.indexOf('data-focus-order="4"'));
  });

  test("marks the selected activity and bottom panel tabs with accessible state", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
      />
    );

    expect(html).toContain('aria-current="page"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
  });

  test("provides tooltips for icon-only editor version buttons", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[
          {
            versionId: "ver_manual_save",
            label: "Manual save",
            createdAt: "2026-07-04T00:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain('title="Preview version Manual save"');
    expect(html).toContain('title="Restore version Manual save"');
  });

  test("defines visible focus and reduced motion CSS hooks", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");

    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("keeps primary text tokens separated from dark surfaces", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    const backgroundLightness = readOklchLightness(css, "--ns-bg");
    const surfaceLightness = readOklchLightness(css, "--ns-surface");
    const inkLightness = readOklchLightness(css, "--ns-ink");
    const mutedLightness = readOklchLightness(css, "--ns-muted");

    expect(inkLightness - backgroundLightness).toBeGreaterThan(0.7);
    expect(mutedLightness - surfaceLightness).toBeGreaterThan(0.45);
  });
});

function readOklchLightness(css: string, tokenName: string): number {
  const match = css.match(new RegExp(`${tokenName}:\\s*oklch\\((\\d+(?:\\.\\d+)?)\\s`));
  if (match?.[1] === undefined) {
    throw new Error(`Missing OKLCH token ${tokenName}`);
  }

  return Number.parseFloat(match[1]);
}
