import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "../src/workspace-shell.js";

describe("Agent Conversation workspace", () => {
  test("uses one conversation navigator and main view without duplicating the AI assistant", () => {
    const application = createDesktopApplication();
    const conversation = {
      conversationId: "conversation-01",
      title: "Review the opening",
      status: "active" as const,
      updatedAtLabel: "16:00",
      runCount: 1,
      turns: []
    };
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={{
          navigator: {
            conversations: [conversation],
            selectedConversationId: conversation.conversationId,
            searchQuery: "",
            filter: "active",
            loading: false,
            onSearchQueryChange: () => undefined,
            onFilterChange: () => undefined,
            onCreate: () => undefined,
            onSelect: () => undefined,
            onArchive: () => undefined,
            onRestore: () => undefined
          },
          view: {
            conversation,
            loading: false,
            onCreate: () => undefined,
            onArchive: () => undefined,
            onRestore: () => undefined,
            onReturnToActive: () => undefined,
            onSend: () => undefined
          }
        }}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
      />
    );

    expect(html).toContain('aria-label="Agent 会话导航"');
    expect(html).toContain('aria-label="Agent 会话主视图"');
    expect(html).toContain('aria-label="Agent 运行检查器"');
    expect(html).not.toContain('aria-label="AI 工作流主视图"');
    expect(html).not.toContain("对话式写作助手");
  });
});
