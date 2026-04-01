import {
  type AboutBlankSettings,
} from "src/settings/settingTab";

import {
  LOOP_MAX,
} from "src/constants";

import {
  type ValuesOf,
} from "src/types";

// =============================================================================

export const ACTION_KINDS = {
  command: "command",
  file: "file",
  url: "url",
} as const;

export const ACTION_KINDS_NAME: {
  [key in ValuesOf<typeof ACTION_KINDS>]: string;
} = {
  command: "命令",
  file: "文件",
  url: "网页",
} as const;

export const ACTION_KINDS_ICON: {
  [key in ValuesOf<typeof ACTION_KINDS>]: string;
} = {
  command: "terminal",
  file: "file-text",
  url: "globe",
} as const;

export interface ContentOfCommand {
  kind: typeof ACTION_KINDS.command;
  commandName: string;
  commandId: string;
}

export interface ContentOfFile {
  kind: typeof ACTION_KINDS.file;
  fileName: string;
  filePath: string;
}

export interface ContentOfUrl {
  kind: typeof ACTION_KINDS.url;
  url: string;
}

export type ContentType = ContentOfCommand | ContentOfFile | ContentOfUrl;

export const NEW_ACTION_CONTENT: {
  [ACTION_KINDS.command]: ContentOfCommand;
  [ACTION_KINDS.file]: ContentOfFile;
  [ACTION_KINDS.url]: ContentOfUrl;
} = {
  command: {
    kind: ACTION_KINDS.command,
    commandName: "",
    commandId: "",
  },
  file: {
    kind: ACTION_KINDS.file,
    fileName: "",
    filePath: "",
  },
  url: {
    kind: ACTION_KINDS.url,
    url: "",
  },
} as const;

export interface Action {
  icon: string;
  name: string;
  cmd: boolean;
  cmdId: string;
  content: ContentType;
}

export const NEW_ACTION: Action = {
  icon: "",
  name: "",
  cmd: false,
  cmdId: "",
  content: NEW_ACTION_CONTENT[ACTION_KINDS.command],
} as const;

// =============================================================================

export const actionPropTypeCheck: {
  [key in keyof Action]: (value: unknown) => boolean;
} = {
  icon: (value: unknown) => typeof value === "string",
  name: (value: unknown) => typeof value === "string",
  cmd: (value: unknown) => typeof value === "boolean",
  cmdId: (value: unknown) => typeof value === "string",
  content: (value: unknown) => {
    const contentValue = value as ContentType;
    if (contentValue.kind === ACTION_KINDS.command) {
      const { commandName, commandId } = contentValue;
      return typeof commandName === "string" && typeof commandId === "string";
    } else if (contentValue.kind === ACTION_KINDS.file) {
      const { fileName, filePath } = contentValue;
      return typeof fileName === "string" && typeof filePath === "string";
    } else if (contentValue.kind === ACTION_KINDS.url) {
      return typeof contentValue.url === "string";
    }
    return false;
  },
};

// =============================================================================

export const newActionClone = (): Action => {
  return structuredClone(NEW_ACTION);
};

// If omit the `settings` argument, it will simply return the UUID.
// If a `settings` is provided, it checks for duplicates and returns a unique ID.
export const genNewCmdId = (settings?: AboutBlankSettings): string => {
  if (settings === undefined) {
    return crypto.randomUUID();
  }

  // Unique ID
  const currentCmdIds = settings.actions.map((action) => action.cmdId);
  for (let i = 0; i < LOOP_MAX; i++) {
    const candidate = crypto.randomUUID();
    if (!currentCmdIds.includes(candidate)) {
      return candidate;
    }
  }
  return newActionClone().cmdId;
};
