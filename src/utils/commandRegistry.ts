import {
  type App,
  type Command,
} from "obsidian";

interface AppWithCommands extends App {
  commands?: {
    commands?: Command[] | Record<string, Command>;
  };
}

export const getRegisteredCommands = (app: App): Command[] => {
  const commands = (app as AppWithCommands).commands?.commands;
  if (Array.isArray(commands)) {
    return commands;
  }
  return commands && typeof commands === "object"
    ? Object.values(commands)
    : [];
};
