import {
  type App,
  type Command,
  type View,
  type Workspace,
  type WorkspaceSplit,
} from "obsidian";

// =============================================================================

export type ConstructableWorkspaceSplit = new (ws: Workspace, dir: "horizontal" | "vertical") => WorkspaceSplit;

export type UnsafeWorkspaceSplit = WorkspaceSplit & {
  containerEl: HTMLElement;
  getRoot: () => WorkspaceSplit;
  getContainer: () => WorkspaceSplit;
};

export type UnsafeWorkspaceWithLayoutChange = Workspace & {
  rootSplit: WorkspaceSplit;
  onLayoutChange: () => void;
};

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

export type UnsafeStatefulView = View & {
  setState: (
    state: { query: string; triggerBySelf: boolean },
    result?: { history: boolean },
  ) => Promise<void> | void;
};

// =============================================================================

export interface UnsafeAppCommands {
  commands: Command[];
  executeCommandById: (id: string) => Promise<boolean>;
}

export interface UnsafeApp extends App {
  commands: UnsafeAppCommands;
}
