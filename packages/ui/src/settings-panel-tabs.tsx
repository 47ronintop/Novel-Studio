export type SettingsPanelSection =
  "models" | "editor" | "writing" | "appearance" | "plugins" | "advanced";
export type SettingsPanelActiveSection = SettingsPanelSection | "overview";

export interface SettingsPanelTabsProps {
  readonly activeSection: SettingsPanelActiveSection;
  readonly onSectionSelect?: ((section: SettingsPanelSection) => void) | undefined;
}

const settingsSections: readonly {
  readonly id: SettingsPanelSection;
  readonly label: string;
}[] = [
  { id: "models", label: "模型" },
  { id: "editor", label: "编辑器" },
  { id: "writing", label: "写作" },
  { id: "appearance", label: "外观" },
  { id: "plugins", label: "插件" },
  { id: "advanced", label: "高级" }
];

export function SettingsPanelTabs({ activeSection, onSectionSelect }: SettingsPanelTabsProps) {
  const currentSection = activeSection === "overview" ? "models" : activeSection;

  return (
    <aside className="model-settings-nav" aria-label="设置分类">
      <div className="model-settings-nav-heading">设置</div>
      <div className="model-settings-category-list" role="list">
        {settingsSections.map((section) => (
          <button
            aria-current={section.id === currentSection ? "page" : undefined}
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
