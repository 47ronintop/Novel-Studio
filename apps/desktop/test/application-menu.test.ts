import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { createApplicationMenuTemplate } from "../src/main/menu";
import { createNovelStudioApi } from "../src/preload/api";

describe("application menu", () => {
  test("uses localized Chinese top-level menu labels", () => {
    const template = createApplicationMenuTemplate();

    expect(template.map((item) => item.label)).toEqual(["文件", "编辑", "视图", "窗口", "帮助"]);
  });

  test("File submenu contains three project lifecycle commands before 关闭窗口 with stable semantic IDs", () => {
    const template = createApplicationMenuTemplate();
    const fileMenu = template.find((item) => item.label === "文件");
    expect(fileMenu).toBeDefined();
    const submenu = fileMenu?.submenu as Array<{ label?: string; id?: string; type?: string; role?: string }>;
    expect(Array.isArray(submenu)).toBe(true);

    const labels = submenu.map((item) => item.label ?? item.role ?? item.type);
    const createIndex = labels.findIndex((l) => l?.includes("新建创作项目"));
    const openCreativeIndex = labels.findIndex((l) => l?.includes("打开创作项目"));
    const openEngineeringIndex = labels.findIndex((l) => l?.includes("打开工程文件夹"));
    const closeIndex = labels.findIndex((l) => l === "关闭窗口" || l === "close");

    expect(createIndex, "新建创作项目… must be present").toBeGreaterThanOrEqual(0);
    expect(openCreativeIndex, "打开创作项目… must be present").toBeGreaterThanOrEqual(0);
    expect(openEngineeringIndex, "打开工程文件夹… must be present").toBeGreaterThanOrEqual(0);
    expect(closeIndex, "关闭窗口 must be present").toBeGreaterThanOrEqual(0);

    expect(createIndex, "新建创作项目… must come before 关闭窗口").toBeLessThan(closeIndex);
    expect(openCreativeIndex, "打开创作项目… must come before 关闭窗口").toBeLessThan(closeIndex);
    expect(openEngineeringIndex, "打开工程文件夹… must come before 关闭窗口").toBeLessThan(closeIndex);

    const ids = submenu.map((item) => item.id);
    expect(ids).toContain("createCreativeProject");
    expect(ids).toContain("openCreativeProject");
    expect(ids).toContain("openEngineeringFolder");
  });

  test("clicking a File lifecycle item invokes onCommand with its semantic id exactly once", () => {
    const received: string[] = [];
    const template = createApplicationMenuTemplate({
      onCommand: (commandId) => received.push(commandId)
    });
    const fileMenu = template.find((item) => item.label === "文件");
    const submenu = fileMenu?.submenu as Array<{ id?: string; click?: () => void }>;

    submenu.find((item) => item.id === "createCreativeProject")?.click?.();
    submenu.find((item) => item.id === "openCreativeProject")?.click?.();
    submenu.find((item) => item.id === "openEngineeringFolder")?.click?.();

    expect(received).toEqual([
      "createCreativeProject",
      "openCreativeProject",
      "openEngineeringFolder"
    ]);
  });

  test("preload exposes a native menu command subscription that filters non-command payloads", () => {
    const invoked: string[] = [];
    let listener: ((payload: unknown) => void) | undefined;
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return undefined;
      },
      on(channel, nextListener) {
        expect(channel).toBe("application:menu:native-command");
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      }
    });

    const received: string[] = [];
    const unsubscribe = api.menu.onNativeCommand((commandId) => received.push(commandId));
    listener?.("createCreativeProject");
    listener?.({ not: "a command" });
    listener?.(42);
    listener?.("openEngineeringFolder");
    unsubscribe();

    expect(received).toEqual(["createCreativeProject", "openEngineeringFolder"]);
    expect(invoked).toEqual([]);
  });

  test("menu.ts has no direct filesystem, Repository, or project-session import", () => {
    const menuSource = readFileSync(
      join(process.cwd(), "apps", "desktop", "src", "main", "menu.ts"),
      "utf8"
    );

    expect(menuSource).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(menuSource).not.toMatch(/from\s+['"]fs['"]/);
    expect(menuSource).not.toMatch(/from\s+['"]node:path['"]/);
    expect(menuSource).not.toMatch(/ProjectCreationRepository|EngineeringWorkspace|ProjectWorkspaceSession/);
    expect(menuSource).not.toMatch(/dialog\.showOpenDialog|dialog\.showSaveDialog/);
    expect(menuSource).not.toMatch(/selectionToken/);
    // menu.ts may expose stable semantic command id *strings* (e.g. "openCreativeProject"),
    // but must never itself call into workflow/navigation business logic by that name.
    expect(menuSource).not.toMatch(/\.openCreativeProject\(|\.openEngineeringWorkspace\(/);
    expect(menuSource).not.toMatch(/from\s+['"].*workspace-navigation/);
    expect(menuSource).not.toMatch(/from\s+['"].*project-workflow-bridge/);
  });
});
