import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const disabled = props.disabled === true;
  const initialFocus = props.initialFocus ?? "first";
  const onOpenChange = props.onOpenChange;

  useEffect(() => {
    if (!open) return;
    if (initialFocus === "none") return;
    if (initialFocus === "first") {
      focusFirst(panelRef.current);
      return;
    }
    initialFocus.current?.focus();
  }, [open, initialFocus]);

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

  return (
    <div className="ns-agent-popover">
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
      {open ? (
        <div
          aria-label={props.panelLabel}
          className={props.panelClassName}
          id={panelId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          ref={panelRef}
          role="dialog"
        >
          {props.children({ close })}
        </div>
      ) : null}
    </div>
  );
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
