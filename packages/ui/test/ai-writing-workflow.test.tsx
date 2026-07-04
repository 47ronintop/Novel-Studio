import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "@novel-studio/ui";

describe("AI writing workflow UI", () => {
  test("renders workflow controls and suggestion trace", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "suggestion-ready",
          instruction: "续写当前场景",
          summary: "补写了主角推门后的动作。",
          contextTraceLabel: "1 source / 4 tokens",
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="AI writing workflow"');
    expect(html).toContain('aria-label="AI writing instruction"');
    expect(html).toContain('aria-label="Generate AI suggestion"');
    expect(html).toContain('aria-label="Apply AI suggestion"');
    expect(html).toContain("补写了主角推门后的动作。");
    expect(html).toContain("1 source / 4 tokens");
  });
});
