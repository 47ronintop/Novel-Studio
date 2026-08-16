// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  AgentModelSharingDialog,
  type AgentModelSharingDialogProps
} from "../src/agent-model-sharing-dialog.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentModelSharingDialog", () => {
  afterEach(() => document.body.replaceChildren());

  test("explains the three disclosure meanings and requires an explicit save", () => {
    const onSave = vi.fn(async () => undefined);
    const { host } = renderDialog({ onSave });

    expect(host.textContent).toContain("自动：可直接加入发送预览");
    expect(host.textContent).toContain("询问：读取或发送前会再向你确认");
    expect(host.textContent).toContain("拒绝：不读取，也不发送");
    expect(host.textContent).toContain("与项目是否可信无关");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("opens with the project selection that was already saved", () => {
    const { host } = renderDialog({
      initialDefaults: {
        outlineMetadata: "off",
        activeResource: "off",
        conversationSummary: "allow",
        toolReadResults: "deny"
      }
    });

    expect(host.querySelector<HTMLSelectElement>('select[aria-label="项目结构摘要"]')?.value).toBe(
      "off"
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="会话摘要"]')?.value).toBe(
      "allow"
    );
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="工具读取结果"]')?.value).toBe(
      "deny"
    );
  });

  test("saves the author's exact selection and offers a manual retry", async () => {
    const onSave = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const { host } = renderDialog({ onSave, onClose });

    changeSelect(host, "当前打开内容", "off");
    changeSelect(host, "会话摘要", "deny");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".ns-ai-send-button")?.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith({
      outlineMetadata: "automatic",
      activeResource: "off",
      conversationSummary: "deny",
      toolReadResults: "ask"
    });
    expect(host.textContent).toContain("已保存当前项目的共享范围并刷新 Agent 运行环境");
    expect(host.textContent).toContain("返回 Agent 重试");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("keeps the dialog editable when Main rejects persistence", async () => {
    const onSave = vi.fn(async () => "保存共享范围失败（POLICY_STALE）。");
    const { host } = renderDialog({ onSave });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".ns-ai-send-button")?.click();
      await Promise.resolve();
    });

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("POLICY_STALE");
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="项目结构摘要"]')?.disabled
    ).toBe(false);
  });
});

function renderDialog(overrides: Partial<AgentModelSharingDialogProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const props: AgentModelSharingDialogProps = {
    open: true,
    onClose: () => undefined,
    onSave: async () => undefined,
    ...overrides
  };
  act(() => root.render(<AgentModelSharingDialog {...props} />));
  return { host };
}

function changeSelect(host: HTMLElement, label: string, value: string): void {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
