import { isCommandPaletteShortcut } from "@novel-studio/ui";

export interface RendererShortcutState {
  readonly commandPaletteOpen: boolean;
}

export interface RendererShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface RendererShortcutResult {
  readonly handled: boolean;
  readonly state: RendererShortcutState;
}

export function reduceRendererShortcut(
  state: RendererShortcutState,
  event: RendererShortcutEvent
): RendererShortcutResult {
  if (isCommandPaletteShortcut(event)) {
    return {
      handled: true,
      state: {
        ...state,
        commandPaletteOpen: true
      }
    };
  }

  return {
    handled: false,
    state
  };
}
