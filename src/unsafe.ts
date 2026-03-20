import {
  type App,
  type Command,
  type View,
  type Workspace,
  type WorkspaceSplit,
} from "obsidian";

// =============================================================================

export type ConstructableWorkspaceSplit = new (ws: Workspace, dir: "horizontal" | "vertical") => WorkspaceSplit;

export const UNSAFE_CSS_CLASSES = {
  defaultEmptyAction: "empty-state-action tappable",
  defaultCloseAction: "mod-close",
} as const;

// =============================================================================

export const UNSAFE_VIEW_TYPES = {
  empty: "empty",
} as const;

export interface UnsafeEmptyActionListEl extends HTMLDivElement {
  children: HTMLCollection;
}

export interface UnsafeEmptyView extends View {
  // Property that `leaf.view` of `empty` should have.
  // This is an action list element (div.empty-state-action-list).
  actionListEl: UnsafeEmptyActionListEl;
  // This is the element that displays the message (div.empty-state-title).
  emptyTitleEl: HTMLDivElement;
}

// =============================================================================

export interface UnsafeAppCommands {
  commands: Command[];
  executeCommandById: (id: string) => Promise<boolean>;
}

export interface UnsafeApp extends App {
  commands: UnsafeAppCommands;
}
