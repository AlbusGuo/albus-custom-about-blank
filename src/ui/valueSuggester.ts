import {
  AbstractInputSuggest,
  type App,
} from "obsidian";

const MAX_VISIBLE_SUGGESTIONS = 100;

export class ValueSuggester extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private readonly targetInputEl: HTMLInputElement,
    private readonly values: string[],
    private readonly multiple = false,
  ) {
    super(app, targetInputEl);
  }

  getSuggestions(inputStr: string): string[] {
    const query = (this.multiple
      ? inputStr.split(",").pop() ?? ""
      : inputStr).trim().toLowerCase();
    return this.values
      .filter((value) => !query || value.toLowerCase().includes(query))
      .slice(0, MAX_VISIBLE_SUGGESTIONS);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    if (this.multiple) {
      const selected = this.targetInputEl.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      selected.pop();
      selected.push(value);
      this.targetInputEl.value = selected.join(", ");
    } else {
      this.targetInputEl.value = value;
    }
    this.targetInputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}
