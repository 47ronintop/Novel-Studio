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
        chapterEditor={{
          chapter,
          saveStatus: "Saved",
          dirty: false,
          versionHistory: []
        }}
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

    expect(html).toContain('title="预览版本 Manual save"');
    expect(html).toContain('title="恢复版本 Manual save"');
  });

  test("defines visible focus and reduced motion CSS hooks", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");

    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("keeps text tokens at WCAG contrast on ink and paper surfaces", () => {
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");

    for (const selector of [":root", '.ns-shell[data-theme="light"]']) {
      const background = readColorToken(css, selector, "--ns-bg");
      const surface = readColorToken(css, selector, "--ns-surface");
      const ink = readColorToken(css, selector, "--ns-ink");
      const muted = readColorToken(css, selector, "--ns-muted");

      expect(contrastRatio(ink, background), `${selector} primary text contrast`).toBeGreaterThanOrEqual(
        4.5
      );
      expect(contrastRatio(muted, surface), `${selector} muted text contrast`).toBeGreaterThanOrEqual(
        4.5
      );
    }
  });

  test("keeps legacy OKLCH colors compatible with the WCAG calculation", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21);
    expect(contrastRatio("oklch(0 0 0)", "oklch(1 0 0)")).toBeCloseTo(21);
  });
});

function readColorToken(css: string, selector: string, tokenName: string): string {
  const blockStart = css.indexOf(`${selector} {`);
  const blockEnd = blockStart === -1 ? -1 : css.indexOf("}", blockStart);
  if (blockStart === -1 || blockEnd === -1) {
    throw new Error(`Missing CSS block ${selector}`);
  }

  const block = css.slice(blockStart, blockEnd);
  const match = block.match(
    new RegExp(`${tokenName}:\\s*(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|oklch\\([^;]+\\))\\s*;`)
  );
  if (match?.[1] === undefined) {
    throw new Error(`Missing color token ${tokenName} in ${selector}`);
  }

  return match[1];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function relativeLuminance(color: string): number {
  if (color.startsWith("#")) {
    const [red, green, blue] = parseHexColor(color);
    return (
      0.2126 * srgbToLinear(red) +
      0.7152 * srgbToLinear(green) +
      0.0722 * srgbToLinear(blue)
    );
  }

  const match = color.match(
    /^oklch\(\s*(\d+(?:\.\d+)?)(%?)\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:deg)?\s*\)$/i
  );
  if (match?.[1] === undefined || match[3] === undefined || match[4] === undefined) {
    throw new Error(`Unsupported CSS color ${color}`);
  }

  const lightness = Number.parseFloat(match[1]) / (match[2] === "%" ? 100 : 1);
  const chroma = Number.parseFloat(match[3]);
  const hue = (Number.parseFloat(match[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function parseHexColor(color: string): [number, number, number] {
  const digits = color.slice(1);
  const expanded = digits.length === 3 ? [...digits].map((digit) => digit.repeat(2)).join("") : digits;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Unsupported hex color ${color}`);
  }

  return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number
  ];
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
