import {
  type App,
  getIconIds,
  setIcon,
  SuggestModal,
} from "obsidian";

import {
  CustomIconManager,
} from "src/utils/customIconManager";

interface IconSuggestionItem {
  value: string;
  label: string;
}

// =============================================================================

export class IconSuggestModal extends SuggestModal<IconSuggestionItem> {
  private readonly icons: IconSuggestionItem[];
  private readonly onChoose: (iconName: string) => void;
  private readonly customIconManager: CustomIconManager;
  private readonly masked: boolean;

  constructor(
    app: App,
    icons: string[],
    masked: boolean,
    onChoose: (iconName: string) => void,
  ) {
    super(app);
    this.onChoose = onChoose;
    this.customIconManager = CustomIconManager.getInstance(app);
    this.masked = masked;
    this.icons = icons.map((icon) => {
      if (icon === "") {
        return {
          value: "",
          label: "无图标",
        };
      }

      return {
        value: icon,
        label: this.customIconManager.isCustomIcon(icon)
          ? this.customIconManager.getDisplayName(icon)
          : icon,
      };
    });

    this.setPlaceholder("搜索图标名称...");
  }

  static async create(
    app: App,
    iconFolder: string,
    masked: boolean,
    onChoose: (iconName: string) => void,
  ): Promise<IconSuggestModal> {
    const customIconManager = CustomIconManager.getInstance(app);
    const customIcons = await customIconManager.getIconsFromFolder(iconFolder);
    return new IconSuggestModal(app, ["", ...customIcons, ...getIconIds()], masked, onChoose);
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

    if (this.customIconManager.isCustomIcon(icon.value)) {
      void this.customIconManager.renderIcon(icon.value, previewEl, this.masked).then((rendered) => {
        if (!rendered) {
          setIcon(previewEl, "help-circle");
        }
      });
      return;
    }

    setIcon(previewEl, icon.value);
  }

  onChooseSuggestion(icon: IconSuggestionItem): void {
    this.onChoose(icon.value);
  }
}