import type { PointerEvent } from "react";

export function createPanelResizeHandler(kind: "navigator" | "ai") {
  return (event: PointerEvent<HTMLDivElement>) => {
    const shell = event.currentTarget.closest(".ns-shell") as HTMLElement | null;
    if (shell === null) {
      return;
    }

    const variable = kind === "navigator" ? "--ns-navigator-width" : "--ns-ai-panel-width";
    const min = kind === "navigator" ? 220 : 280;
    const max = kind === "navigator" ? 420 : 520;
    const startX = event.clientX;
    const initialWidth =
      parseFloat(globalThis.getComputedStyle(shell).getPropertyValue(variable)) ||
      (kind === "navigator" ? 260 : 320);

    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = kind === "navigator" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const nextWidth = Math.min(max, Math.max(min, initialWidth + delta));
      shell.style.setProperty(variable, `${nextWidth}px`);
    };

    const handlePointerUp = () => {
      globalThis.window.removeEventListener("pointermove", handlePointerMove);
      globalThis.window.removeEventListener("pointerup", handlePointerUp);
    };

    globalThis.window.addEventListener("pointermove", handlePointerMove);
    globalThis.window.addEventListener("pointerup", handlePointerUp, { once: true });
  };
}
