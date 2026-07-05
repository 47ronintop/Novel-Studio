import { describe, expect, test } from "vitest";

import { createApplicationMenuTemplate } from "../src/main/menu";

describe("application menu", () => {
  test("uses localized Chinese top-level menu labels", () => {
    const template = createApplicationMenuTemplate();

    expect(template.map((item) => item.label)).toEqual(["文件", "编辑", "视图", "窗口", "帮助"]);
  });
});
