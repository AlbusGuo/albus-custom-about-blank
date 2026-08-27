import {
  AbstractInputSuggest,
  type App,
  type Command,
  prepareFuzzySearch,
  TFile,
} from "obsidian";

import {
  getRegisteredCommands,
} from "src/utils/commandRegistry";

export class CommandInputSuggester extends AbstractInputSuggest<Command> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onChoose: (command: Command) => void,
  ) {
    super(app, inputEl);
    this.limit = 50;
    this.onSelect(onChoose);
  }

  protected getSuggestions(query: string): Command[] {
    const commands = getRegisteredCommands(this.app);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return commands;
    }
    const search = prepareFuzzySearch(normalizedQuery);
    return commands.filter((command) => search(`${command.name} ${command.id}`));
  }

  renderSuggestion(command: Command, el: HTMLElement): void {
    el.setText(command.name);
  }
}

export class FileInputSuggester extends AbstractInputSuggest<TFile> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onChoose: (file: TFile) => void,
  ) {
    super(app, inputEl);
    this.limit = 50;
    this.onSelect(onChoose);
  }

  protected getSuggestions(query: string): TFile[] {
    const files = this.app.vault.getFiles();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return files;
    }
    const search = prepareFuzzySearch(normalizedQuery);
    return files.filter((file) => search(`${file.name} ${file.basename} ${file.path}`));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }
}
