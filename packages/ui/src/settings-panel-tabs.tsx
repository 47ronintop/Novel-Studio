export type SettingsPanelSection = "models" | "appearance" | "plugins" | "usage";
export type SettingsPanelActiveSection = SettingsPanelSection;

export interface SettingsPanelTabsProps {
  readonly activeSection: SettingsPanelActiveSection;
  readonly onSectionSelect?: ((section: SettingsPanelSection) => void) | undefined;
}

const settingsSections = [
  { id: "models", label: "模型" },
  { id: "appearance", label: "外观" },
  { id: "plugins", label: "插件" },
  { id: "usage", label: "Agent 用量" }
] as const satisfies readonly {
  readonly id: SettingsPanelSection;
  readonly label: string;
}[];

export function SettingsPanelTabs({ activeSection, onSectionSelect }: SettingsPanelTabsProps) {
  return (
    <aside className="model-settings-nav" aria-label="设置分类">
      <div className="model-settings-nav-heading">设置</div>
      <div className="model-settings-category-list" role="list">
        {settingsSections.map((section) => (
          <button
            aria-current={section.id === activeSection ? "page" : undefined}
            className="model-settings-category-item"
            key={section.id}
            onClick={() => onSectionSelect?.(section.id)}
            role="listitem"
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
