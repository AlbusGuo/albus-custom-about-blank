import {
  type App,
  SuggestModal,
} from "obsidian";

import {
  loggerOnError,
} from "src/commons";

type ValueType = string;

interface SuggesterType {
  name: string;
  value: ValueType;
}

interface AbortedType {
  name: null;
  value: null;
}

interface NormalResponse {
  result: SuggesterType;
  aborted: false;
}

interface AbortedResponse {
  result: AbortedType;
  aborted: true;
}

type SuggesterResponse = NormalResponse | AbortedResponse;

// =============================================================================

export class StringSuggesterAsync extends SuggestModal<SuggesterType> {
  items: SuggesterType[];
  response: Promise<SuggesterResponse>;
  resolve: (resolution: SuggesterResponse) => void;

  abortedResponse: AbortedResponse = {
    result: {
      name: null,
      value: null,
    },
    aborted: true,
  } as const;

  constructor(
    app: App,
    items: SuggesterType[],
    placeholder: string | null = null,
    // title: string | null = null,
  ) {
    super(app);
    this.items = items;
    if (typeof placeholder === "string") {
      this.setPlaceholder(placeholder);
    }
    // if (typeof title === "string") {
    //   this.setTitle(title);
    // }
    this.response = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  openReturnThis = () => {
    this.open();
    return this;
  };

  openAndRespond = async () => {
    // Avoid `return await` for error handling.
    return this.openReturnThis().response;
  };

  onClose() {
    try {
      // If the operation is aborted or otherwise unresolved, resolve it with `abortedResponse`.
      this.resolve(this.abortedResponse);
    } catch (error) {
      loggerOnError(error, "Error when closing suggester.");
    }
  }

  // If separated by spaces, the search will be performed using "AND" conditions.
  getSuggestions(query: string): SuggesterType[] {
    try {
      const splitQueries = query.trim().split(" ");
      return this.items.filter((item) => {
        return splitQueries.every((splitQuery) => {
          return item.name.toLowerCase().includes(splitQuery.toLowerCase());
        });
      });
    } catch (error) {
      loggerOnError(error, "Failed to get suggestions.");
      return [];
    }
  }

  renderSuggestion(item: SuggesterType, elem: HTMLElement) {
    try {
      elem.createEl("div", { text: item.name });
    } catch (error) {
      loggerOnError(error, "Failed to render suggestion.");
    }
  }

  // This is called after `this.close()`.
  // Use `selectSuggestion()` instead to resolve to a `defaultResult` in `onClose()`.
  onChooseSuggestion(item: SuggesterType, event: MouseEvent | KeyboardEvent) {}

  // This usually calls `this.close()` and then `this.onChooseSuggestion()`.
  selectSuggestion(item: SuggesterType, event: MouseEvent | KeyboardEvent) {
    try {
      // this.app.keymap.updateModifiers(event);
      this.resolve({
        result: item,
        aborted: false,
      });
      this.close();
    } catch (error) {
      loggerOnError(error, "Failed to select suggestion.");
    }
  }
}
