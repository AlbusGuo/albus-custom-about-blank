import {
  type App,
  getIconIds,
  setIcon,
  SuggestModal,
} from "obsidian";

interface IconSuggestionItem {
  value: string;
  label: string;
}

// =============================================================================

export class IconSuggestModal extends SuggestModal<IconSuggestionItem> {
  private readonly icons: IconSuggestionItem[];
  private readonly onChoose: (iconName: string) => void;

  constructor(
    app: App,
    icons: string[],
    onChoose: (iconName: string) => void,
  ) {
    super(app);
    this.onChoose = onChoose;
    this.icons = icons.map((icon) => {
      if (icon === "") {
        return {
          value: "",
          label: "无图标",
        };
      }

      return {
        value: icon,
        label: icon,
      };
    });

    this.setPlaceholder("搜索图标名称...");
  }

  static create(
    app: App,
    onChoose: (iconName: string) => void,
  ): IconSuggestModal {
    const defaultIconIds = getIconIds().filter((iconId) => !iconId.startsWith("CI-"));
    return new IconSuggestModal(app, ["", ...defaultIconIds], onChoose);
  }

  getSuggestions(query: string): IconSuggestionItem[] {
    const lowerQuery = query.toLowerCase();
    if (!lowerQuery) {
      return this.icons;
    }

    const splitQueries = lowerQuery.trim().split(" ").filter(Boolean);
    return this.icons.filter((icon) => {
      return splitQueries.every((keyword) => icon.label.toLowerCase().includes(keyword));
    });
  }

  renderSuggestion(icon: IconSuggestionItem, el: HTMLElement): void {
    el.classList.add("mod-complex");
    el.createEl("div", { text: icon.label });

    const previewEl = el.createEl("div", { cls: "about-blank-icon-suggestion-preview" });
    if (!icon.value) {
      setIcon(previewEl, "slash");
      return;
    }

    try {
      setIcon(previewEl, icon.value);
      if (!previewEl.querySelector("svg")) {
        setIcon(previewEl, "help-circle");
      }
    } catch {
      setIcon(previewEl, "help-circle");
    }
  }

  onChooseSuggestion(icon: IconSuggestionItem): void {
    this.onChoose(icon.value);
  }
}
