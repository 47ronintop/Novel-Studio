import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkbenchMode } from "@novel-studio/shared";

export interface WorkbenchSwitcherProps {
  readonly mode: WorkbenchMode;
  readonly creativeDisabledReason?: string;
  readonly onSelect: (mode: WorkbenchMode) => void;
}

const modes: readonly { mode: WorkbenchMode; label: string }[] = [
  { mode: "creative", label: "创作工作台" },
  { mode: "engineering", label: "工程工作台" }
];

export function WorkbenchSwitcher({
  mode,
  creativeDisabledReason,
  onSelect
}: WorkbenchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, modes.findIndex((entry) => entry.mode === mode));
    itemRefs.current[index]?.focus();
  }, [mode, open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  const select = (next: WorkbenchMode) => {
    if (next === "creative" && creativeDisabledReason !== undefined) return;
    onSelect(next);
    close();
  };

  const moveFocus = (index: number) => {
    const enabled = modes
      .map((entry, entryIndex) => ({ entry, entryIndex }))
      .filter(({ entry }) => entry.mode !== "creative" || creativeDisabledReason === undefined);
    const current = enabled.findIndex(({ entry }) => entry.mode === mode);
    const target = enabled[Math.max(0, Math.min(enabled.length - 1, current + index))];
    if (target?.entryIndex !== undefined) {
      itemRefs.current[target.entryIndex]?.focus();
    }
  };

  return (
    <div className="ns-workbench-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`当前工作台：${labelFor(mode)}`}
        className="ns-workbench-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
        type="button"
      >
        <span>{labelFor(mode)}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div aria-label="工作台选择" className="ns-workbench-menu" role="menu">
          {modes.map((entry, index) => {
            const disabled = entry.mode === "creative" && creativeDisabledReason !== undefined;
            const reasonId = disabled ? "ns-workbench-creative-disabled" : undefined;
            return (
              <button
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                aria-checked={entry.mode === mode}
                aria-describedby={reasonId}
                aria-disabled={disabled}
                aria-label={entry.label}
                className="ns-workbench-menu-item"
                key={entry.mode}
                onClick={() => select(entry.mode)}
                onKeyDown={(event) => {
                  switch (event.key) {
                    case "Escape":
                      event.preventDefault();
                      close();
                      break;
                    case "ArrowDown":
                      event.preventDefault();
                      moveFocus(1);
                      break;
                    case "ArrowUp":
                      event.preventDefault();
                      moveFocus(-1);
                      break;
                    case "Home":
                      event.preventDefault();
                      moveFocus(-modes.length);
                      break;
                    case "End":
                      event.preventDefault();
                      moveFocus(modes.length);
                      break;
                    case "Enter":
                    case " ":
                      event.preventDefault();
                      select(entry.mode);
                      break;
                  }
                }}
                role="menuitemradio"
                type="button"
              >
                <span>{entry.label}</span>
                {entry.mode === mode ? <span aria-hidden="true">当前</span> : null}
              </button>
            );
          })}
          {creativeDisabledReason === undefined ? null : (
            <p className="ns-workbench-disabled-reason" id="ns-workbench-creative-disabled">
              {creativeDisabledReason}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function labelFor(mode: WorkbenchMode): string {
  return mode === "engineering" ? "工程工作台" : "创作工作台";
}
