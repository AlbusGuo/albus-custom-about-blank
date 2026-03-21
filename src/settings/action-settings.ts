import {
  type App,
  type TFile,
} from "obsidian";

import {
  ACTION_KINDS,
  ACTION_KINDS_NAME,
  type ContentType,
  newContentOfCommandClone,
  newContentOfFileClone,
} from "src/settings/action-basic";

import {
  StringSuggesterAsync,
} from "src/ui/stringSuggesterAsync";

import {
  type ValuesOf,
} from "src/types";

import {
  type UnsafeApp,
} from "src/unsafe";

// =============================================================================

export const chooseKindAndContent = async (
  app: App,
): Promise<ContentType | void> => {
  const kind = await chooseKind(app);
  if (kind === undefined) {
    return;
  }

  return chooseContent(app, kind);
};

export const chooseKind = async (
  app: App,
): Promise<ValuesOf<typeof ACTION_KINDS> | void> => {
  const kindItems = Object.values(ACTION_KINDS).map((kind) => {
    return {
      name: ACTION_KINDS_NAME[kind],
      value: kind,
    };
  });

  const kindResponse = await new StringSuggesterAsync(
    app,
    kindItems,
    "Kind...",
  ).openAndRespond();
  if (kindResponse.aborted) {
    return;
  }

  return kindResponse.result.value as ValuesOf<typeof ACTION_KINDS>;
};

export const chooseContent = async (
  app: App,
  kind: ValuesOf<typeof ACTION_KINDS>,
): Promise<ContentType | void> => {
  const result = await chooseCommandOrFile(app, kind);
  if (result === undefined) {
    return;
  }

  if (kind === ACTION_KINDS.file) {
    const content = newContentOfFileClone();
    content.fileName = result.name;
    content.filePath = result.value;
    return content;
  }

  // kind === ACTION_KINDS.command
  const content = newContentOfCommandClone();
  content.commandName = result.name;
  content.commandId = result.value;
  return content;
};

export const chooseCommandOrFile = async (
  app: App,
  kind: typeof ACTION_KINDS.command | typeof ACTION_KINDS.file,
): Promise<
  {
    name: string;
    value: string;
  } | void
> => {
  const items = (() => {
    if (kind === ACTION_KINDS.command) {
      const commandsList = (app as UnsafeApp).commands.commands;
      return Object.values(commandsList).map((command) => {
        return {
          name: command.name,
          value: command.id,
        };
      });
    } else if (kind === ACTION_KINDS.file) {
      return app.vault.getFiles().map((file: TFile) => {
        return {
          name: file.name,
          value: file.path,
        };
      });
    }
    return;
  })();
  if (items === undefined) {
    return;
  }

  const response = await new StringSuggesterAsync(
    app,
    items,
    `${ACTION_KINDS_NAME[kind]}...`,
  ).openAndRespond();
  if (response.aborted) {
    return;
  }

  return response.result;
};
