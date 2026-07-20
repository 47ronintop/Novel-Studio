import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { AgentConversationNavigator } from "./agent-conversation-navigator.js";
import type { AgentConversationNavigatorProps } from "./workspace-shell-types.js";

export function AgentConversationHistoryDrawer({
  navigator,
  onClose
}: {
  readonly navigator: AgentConversationNavigatorProps;
  readonly onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="ns-agent-history-drawer" aria-label="历史会话抽屉" role="dialog">
      <div className="ns-agent-history-drawer-backdrop" onClick={onClose} />
      <aside className="ns-agent-history-drawer-content">
        <header className="ns-agent-history-drawer-header">
          <strong>历史会话</strong>
          <button
            ref={closeRef}
            aria-label="关闭历史会话"
            className="ns-icon-button"
            onClick={onClose}
            title="关闭历史会话"
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </header>
        <AgentConversationNavigator {...navigator} />
      </aside>
    </div>
  );
}
