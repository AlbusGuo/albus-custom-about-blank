import { AbstractInputSuggest, type App, TFile } from "obsidian";

export class ExtensionSuggester extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  getSuggestions(inputStr: string): string[] {
    const allFiles = this.app.vault.getAllLoadedFiles();
    const extSet = new Set<string>();
    const lowerInput = inputStr.toLowerCase();

    for (const file of allFiles) {
      if (file instanceof TFile && file.extension) {
        if (file.extension.toLowerCase().includes(lowerInput)) {
          extSet.add(file.extension);
        }
      }
    }

    return Array.from(extSet).sort();
  }

  renderSuggestion(ext: string, el: HTMLElement): void {
    el.setText(`.${ext}`);
  }

  selectSuggestion(ext: string): void {
    this.inputEl.value = ext;
    this.inputEl.trigger("input");
    this.inputEl.blur();
    this.close();
  }
}
