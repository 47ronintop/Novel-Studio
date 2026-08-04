// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentConversationInspector } from "../src/agent-conversation-inspector.js";
import type { AgentConversationViewProps } from "../src/workspace-shell-types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];

describe("AgentConversationInspector", () => {
  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  test("keeps the first preview binding distinct from later-round additions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push(root);
    act(() => root.render(<AgentConversationInspector view={view()} />));

    const ledger = host.querySelector('[aria-label="发送账本"]');
    const entries = ledger?.querySelectorAll(":scope > ol > li");
    expect(entries).toHaveLength(2);
    expect(entries?.[0]?.textContent).toContain("首轮预览绑定");
    expect(entries?.[0]?.textContent).toContain("preview_01");
    expect(entries?.[0]?.textContent).not.toContain("ROUND TWO CONTENT");
    expect(entries?.[1]?.textContent).toContain("本轮新增 1 项");
    expect(entries?.[1]?.textContent).toContain("Assistant");
    expect(entries?.[1]?.textContent).toContain("ROUND TWO CONTENT");
  });
});

function view(): AgentConversationViewProps {
  const noop = vi.fn();
  return {
    loading: false,
    onCreate: noop,
    onArchive: noop,
    onRestore: noop,
    onReturnToActive: noop,
    agentRun: {
      projectId: "project_01",
      conversationId: "conversation_01",
      runId: "run_01",
      status: "completed",
      assistantText: "",
      events: [],
      onAnswerUserInput: noop,
      onResume: noop,
      onRetryStep: noop,
      onRefreshContext: noop,
      sendLedger: [
        {
          entryId: "send_01",
          roundNumber: 0,
          roundKind: "first_send",
          canonicalPayloadChecksum: "a".repeat(64),
          canonicalRoundManifestChecksum: "b".repeat(64),
          previewId: "preview_01",
          sentAtLabel: "20:00",
          additions: []
        },
        {
          entryId: "send_02",
          roundNumber: 1,
          roundKind: "subsequent_send",
          canonicalPayloadChecksum: "c".repeat(64),
          canonicalRoundManifestChecksum: "d".repeat(64),
          previewId: null,
          sentAtLabel: "20:01",
          additions: [
            {
              additionId: "assistant_01",
              kind: "assistant",
              content: "ROUND TWO CONTENT",
              contentChecksum: "e".repeat(64)
            }
          ]
        }
      ]
    }
  };
}
