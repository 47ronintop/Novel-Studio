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

export interface ShortcutDeclaration {
  readonly commandId: string;
  readonly label: string;
  readonly shortcut: string;
}

export interface NormalizedShortcutDeclaration extends ShortcutDeclaration {
  readonly normalizedShortcut: string;
}

export interface ShortcutConflict {
  readonly normalizedShortcut: string;
  readonly commandIds: readonly string[];
  readonly labels: readonly string[];
}

export interface ShortcutConflictMatrix {
  readonly conflicts: readonly ShortcutConflict[];
  readonly entries: readonly NormalizedShortcutDeclaration[];
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

export function createShortcutConflictMatrix(
  declarations: readonly ShortcutDeclaration[]
): ShortcutConflictMatrix {
  const entries = declarations.map((declaration) => ({
    ...declaration,
    normalizedShortcut: normalizeShortcut(declaration.shortcut)
  }));
  const grouped = new Map<string, NormalizedShortcutDeclaration[]>();

  for (const entry of entries) {
    const existing = grouped.get(entry.normalizedShortcut) ?? [];
    grouped.set(entry.normalizedShortcut, [...existing, entry]);
  }

  return {
    conflicts: [...grouped.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([normalizedShortcut, group]) => ({
        normalizedShortcut,
        commandIds: group.map((entry) => entry.commandId),
        labels: group.map((entry) => entry.label)
      })),
    entries
  };
}

function normalizeShortcut(shortcut: string): string {
  return shortcut
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/cmd\/ctrl/g, "ctrl/cmd")
    .replace(/cmd\/ctrl/g, "ctrl/cmd")
    .replace(/cmdorctrl/g, "ctrl/cmd")
    .replace(/commandorcontrol/g, "ctrl/cmd");
}
