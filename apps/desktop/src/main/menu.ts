import type { MenuItemConstructorOptions } from "electron";
import type { NativeMenuCommandId } from "@novel-studio/application";

export interface CreateApplicationMenuTemplateOptions {
  readonly onCommand?: (commandId: NativeMenuCommandId) => void;
}

const FILE_MENU_ITEM_LABELS: Readonly<Record<NativeMenuCommandId, string>> = {
  createCreativeProject: "新建创作项目…",
  openCreativeProject: "打开创作项目…",
  openEngineeringFolder: "打开工程文件夹…"
};

const FILE_LIFECYCLE_COMMAND_IDS: readonly NativeMenuCommandId[] = [
  "createCreativeProject",
  "openCreativeProject",
  "openEngineeringFolder"
];

export function createApplicationMenuTemplate(
  options: CreateApplicationMenuTemplateOptions = {}
): MenuItemConstructorOptions[] {
  const onCommand = options.onCommand ?? (() => undefined);
  const fileLifecycleItems: MenuItemConstructorOptions[] = FILE_LIFECYCLE_COMMAND_IDS.map(
    (commandId) => ({
      id: commandId,
      label: FILE_MENU_ITEM_LABELS[commandId],
      click: () => onCommand(commandId)
    })
  );

  return [
    {
      label: "文件",
      submenu: [
        ...fileLifecycleItems,
        { type: "separator" },
        { role: "close", label: "关闭窗口" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { role: "close", label: "关闭" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 Novel Studio",
          enabled: false
        }
      ]
    }
  ];
}
