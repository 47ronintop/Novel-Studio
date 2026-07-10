import { X } from "lucide-react";
import { useEffect } from "react";

import { ModelSettingsPanel, type ModelSettingsPanelProps } from "./model-settings-panel.js";

export interface SettingsWorkspaceProps {
  readonly settings?: ModelSettingsPanelProps | undefined;
  readonly onClose?: (() => void) | undefined;
}

export function SettingsWorkspace({ settings, onClose }: SettingsWorkspaceProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose?.();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <main className="ns-settings-workspace" data-region="settings-workspace">
      <button
        aria-label="关闭设置"
        className="ns-icon-button ns-settings-close"
        onClick={onClose}
        title="关闭设置"
        type="button"
      >
        <X aria-hidden="true" size={16} />
      </button>
      {settings === undefined ? (
        <section aria-label="设置不可用" className="ns-settings-unavailable">
          <h1>设置</h1>
          <p>当前项目尚未加载设置数据。</p>
        </section>
      ) : (
        <ModelSettingsPanel {...settings} />
      )}
    </main>
  );
}
