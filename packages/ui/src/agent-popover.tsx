import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { createPortal } from "react-dom";

/**
 * Where focus lands when the popover opens: an explicit element ref (e.g. the currently-selected
 * option), the first focusable control in the panel, or nowhere (the panel keeps DOM focus).
 */
export type AgentPopoverInitialFocus = RefObject<HTMLElement | null> | "first" | "none";

export interface AgentPopoverRenderProps {
  /** Close the panel and return focus to the trigger. */
  readonly close: () => void;
}

export interface AgentPopoverProps {
  /** Accessible name of the trigger button. */
  readonly triggerLabel: string;
  /** Native tooltip text for the trigger button. */
  readonly triggerTitle?: string;
  /** Visible trigger content (label text, chevron, badge, …). */
  readonly triggerContent: ReactNode;
  readonly triggerClassName?: string;
  readonly rootClassName?: string;
  /** Accessible name of the `role="dialog"` panel. */
  readonly panelLabel: string;
  readonly panelClassName?: string;
  readonly disabled?: boolean;
  /**
   * Where focus lands on open. Defaults to the first focusable control. Pass a ref to focus a
   * specific option (e.g. the currently-selected mode), or "none" to leave focus on the panel.
   */
  readonly initialFocus?: AgentPopoverInitialFocus;
  /** Notified whenever the panel opens or closes, so a parent can coordinate sibling popovers. */
  readonly onOpenChange?: (open: boolean) => void;
  readonly children: (render: AgentPopoverRenderProps) => ReactNode;
}

/**
 * The one shared popover behavior for the Agent composer: a trigger button plus a `role="dialog"`
 * panel with a single open/close/auto-focus/Escape contract. Every composer menu (modes, references,
 * context status, model, reasoning) uses this so their keyboard and focus behavior never diverge.
 * Roving arrow-key focus inside an option group is provided by {@link rovePopoverOptions}.
 */
export function AgentPopover(props: AgentPopoverProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [floatingHost, setFloatingHost] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const disabled = props.disabled === true;
  const initialFocus = props.initialFocus ?? "first";
  const onOpenChange = props.onOpenChange;

  useLayoutEffect(() => {
    if (!open || triggerRef.current === null) return;
    setFloatingHost(ensureFloatingLayer(triggerRef.current));
  }, [open]);

  useLayoutEffect(() => {
    if (!open || floatingHost === null) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (trigger === null || panel === null) return;

    const updatePosition = (): void => positionFloatingPanel(trigger, panel);
    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updatePosition);
    observer?.observe(panel);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [floatingHost, open]);

  useEffect(() => {
    if (!open) return;
    if (initialFocus === "none") return;
    if (initialFocus === "first") {
      focusFirst(panelRef.current);
      return;
    }
    initialFocus.current?.focus();
  }, [floatingHost, open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      change(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  });

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      onOpenChange?.(false);
    }
  }, [disabled, open, onOpenChange]);

  function change(next: boolean): void {
    if (next && disabled) return;
    setOpen(next);
    onOpenChange?.(next);
  }

  function close(): void {
    change(false);
    triggerRef.current?.focus();
  }

  const panel =
    open && floatingHost !== null
      ? createPortal(
          <div
            aria-label={props.panelLabel}
            className={["ns-agent-floating-popover", props.panelClassName]
              .filter(Boolean)
              .join(" ")}
            id={panelId}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            ref={panelRef}
            role="dialog"
            style={{ visibility: "hidden" }}
            tabIndex={-1}
          >
            {props.children({ close })}
          </div>,
          floatingHost
        )
      : null;

  return (
    <>
      <div className={["ns-agent-popover", props.rootClassName].filter(Boolean).join(" ")}>
        <button
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={props.triggerLabel}
          className={props.triggerClassName}
          disabled={disabled}
          onClick={() => change(!open)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              change(true);
            }
          }}
          ref={triggerRef}
          title={props.triggerTitle ?? props.triggerLabel}
          type="button"
        >
          {props.triggerContent}
        </button>
      </div>
      {panel}
    </>
  );
}

function ensureFloatingLayer(trigger: HTMLElement): HTMLElement {
  const owner = trigger.closest<HTMLElement>(".ns-shell") ?? document.body;
  const existing = Array.from(owner.children).find((child) =>
    child.classList.contains("ns-agent-popover-layer")
  );
  if (existing instanceof HTMLElement) return existing;
  const layer = document.createElement("div");
  layer.className = "ns-agent-popover-layer";
  owner.append(layer);
  return layer;
}

function positionFloatingPanel(trigger: HTMLElement, panel: HTMLElement): void {
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const margin = 8;
  const gap = 6;

  panel.style.left = "0px";
  panel.style.top = "0px";
  panel.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;
  panel.style.maxHeight = "";
  const triggerRect = trigger.getBoundingClientRect();
  const initialPanelRect = panel.getBoundingClientRect();
  const spaceAbove = Math.max(0, triggerRect.top - margin - gap);
  const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin - gap);
  const placeAbove =
    initialPanelRect.height <= spaceAbove ||
    (initialPanelRect.height > spaceBelow && spaceAbove >= spaceBelow);
  panel.style.maxHeight = `${Math.max(0, Math.floor(placeAbove ? spaceAbove : spaceBelow))}px`;

  const panelRect = panel.getBoundingClientRect();
  const maxLeft = Math.max(margin, viewportWidth - margin - panelRect.width);
  const left = Math.min(Math.max(triggerRect.left, margin), maxLeft);
  const preferredTop = placeAbove
    ? triggerRect.top - gap - panelRect.height
    : triggerRect.bottom + gap;
  const maxTop = Math.max(margin, viewportHeight - margin - panelRect.height);
  const top = Math.min(Math.max(preferredTop, margin), maxTop);

  panel.dataset.placement = placeAbove ? "top" : "bottom";
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.visibility = "visible";
}

/**
 * Roving arrow-key focus within one option group: Arrow Left/Up moves to the previous button and
 * Arrow Right/Down to the next, wrapping at the ends. Attach to each option's `onKeyDown`; the group
 * is the option's parent element (mirroring the Stage 5.0 mode popover).
 */
export function rovePopoverOptions(event: KeyboardEvent<HTMLElement>): void {
  if (
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowRight" &&
    event.key !== "ArrowUp" &&
    event.key !== "ArrowDown"
  ) {
    return;
  }
  event.preventDefault();
  const options = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? []
  );
  const index = options.indexOf(event.currentTarget as HTMLButtonElement);
  if (index === -1) return;
  const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  options[(index + delta + options.length) % options.length]?.focus();
}

function focusFirst(panel: HTMLElement | null): void {
  panel
    ?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    ?.focus();
}
