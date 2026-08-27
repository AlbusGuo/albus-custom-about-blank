import {
  prepareFuzzySearch,
  setIcon,
} from "obsidian";

export interface OptionPickerItem {
  value: string;
  label: string;
  keywords?: string[];
  icon?: string;
}

interface OptionPickerOptions {
  items: OptionPickerItem[];
  value: string;
  className: string;
  ariaLabel: string;
  onSelect: (value: string) => void;
}

const MAX_VISIBLE_OPTIONS = 100;

export class OptionPicker {
  readonly triggerEl: HTMLButtonElement;
  private readonly iconEl: HTMLSpanElement;
  private readonly labelEl: HTMLSpanElement;
  private popoverEl: HTMLElement | null = null;
  private listenerController: AbortController | null = null;
  private currentValue: string;

  constructor(
    parentEl: HTMLElement,
    private readonly options: OptionPickerOptions,
  ) {
    this.currentValue = options.value;
    this.triggerEl = parentEl.createEl("button", {
      cls: [
        "combobox-button",
        "about-blank-filter-option-trigger",
        ...options.className.split(/\s+/).filter(Boolean),
      ],
      attr: {
        type: "button",
        "aria-label": options.ariaLabel,
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      },
    });
    this.iconEl = this.triggerEl.createSpan({
      cls: "combobox-button-icon",
    });
    this.labelEl = this.triggerEl.createSpan({
      cls: "combobox-button-label",
    });
    const iconEl = this.triggerEl.createSpan({
      cls: "combobox-button-chevron",
    });
    setIcon(iconEl, "chevrons-up-down");
    this.updateLabel();
    this.triggerEl.addEventListener("click", () => {
      if (this.popoverEl) {
        this.close();
      } else {
        this.open();
      }
    });
  }

  destroy(): void {
    this.close();
  }

  private open(): void {
    const document = this.triggerEl.ownerDocument;
    const view = document.defaultView;
    if (!view) {
      return;
    }
    const popoverHostEl = this.triggerEl.closest<HTMLElement>(".modal")
      ?? document.body;
    const popoverEl = popoverHostEl.createDiv({
      cls: [
        "combobox",
        "suggestion-container",
        "has-input-focus",
        "about-blank-option-picker-popover",
      ],
      attr: { role: "dialog" },
    });
    this.popoverEl = popoverEl;
    this.triggerEl.setAttribute("aria-expanded", "true");
    this.triggerEl.addClass("has-focus");
    this.triggerEl.closest<HTMLElement>(".filter-expression")
      ?.addClass("has-focus");

    const searchWrapEl = popoverEl.createDiv({
      cls: "search-input-container",
    });
    const searchInputEl = searchWrapEl.createEl("input", {
      attr: {
        type: "search",
        placeholder: "输入并开始搜索...",
        autocomplete: "off",
      },
    });
    const listEl = popoverEl.createDiv({
      cls: "suggestion",
      attr: { role: "listbox" },
    });
    let optionButtons: HTMLElement[] = [];
    let activeIndex = -1;
    const updateActiveItem = (): void => {
      optionButtons.forEach((button, index) => {
        button.classList.toggle("is-selected", index === activeIndex);
      });
      optionButtons[activeIndex]?.scrollIntoView({ block: "nearest" });
    };
    const renderItems = (): void => {
      const query = searchInputEl.value.trim();
      const search = query ? prepareFuzzySearch(query) : null;
      const items = this.options.items
        .filter((item) => {
          if (!search) {
            return true;
          }
          return Boolean(search([
            item.label,
            item.value,
            ...(item.keywords ?? []),
          ].join(" ")));
        })
        .slice(0, MAX_VISIBLE_OPTIONS);
      listEl.empty();
      optionButtons = [];
      activeIndex = -1;
      if (items.length === 0) {
        listEl.createDiv({
          cls: "suggestion-empty",
          text: "没有匹配的选项",
        });
        return;
      }
      items.forEach((item) => {
        const itemEl = listEl.createDiv({
          cls: [
            "suggestion-item",
            "mod-complex",
            "about-blank-option-picker-item",
          ],
          attr: {
            role: "option",
            tabindex: "0",
            "aria-selected": String(item.value === this.currentValue),
          },
        });
        if (item.icon) {
          const itemIconEl = itemEl.createSpan({ cls: "suggestion-icon" });
          const itemFlairEl = itemIconEl.createSpan({ cls: "suggestion-flair" });
          setIcon(itemFlairEl, item.icon);
        }
        const textEl = itemEl.createDiv({
          cls: "suggestion-content about-blank-option-picker-item-text",
        });
        textEl.createDiv({
          cls: "suggestion-title about-blank-option-picker-item-label",
          text: item.label,
        });
        const auxEl = itemEl.createSpan({ cls: "suggestion-aux" });
        if (item.value !== item.label) {
          auxEl.createSpan({
            cls: "about-blank-option-picker-item-value",
            text: item.value,
          });
        }
        if (item.value === this.currentValue) {
          const selectedEl = auxEl.createSpan({
            cls: "suggestion-flair about-blank-option-picker-item-selected",
          });
          setIcon(selectedEl, "check");
        }
        itemEl.addEventListener("click", () => {
          this.currentValue = item.value;
          this.updateLabel();
          this.options.onSelect(item.value);
          this.close();
        });
        itemEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            itemEl.click();
          }
        });
        itemEl.addEventListener("mouseenter", () => {
          activeIndex = optionButtons.indexOf(itemEl);
          updateActiveItem();
        });
        optionButtons.push(itemEl);
      });
    };
    searchInputEl.addEventListener("input", renderItems);
    searchInputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex = Math.min(optionButtons.length - 1, activeIndex + 1);
        updateActiveItem();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = Math.max(0, activeIndex - 1);
        updateActiveItem();
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        optionButtons[activeIndex]?.click();
      }
    });
    renderItems();
    this.positionPopover(popoverEl, view);

    this.listenerController = new AbortController();
    const signal = this.listenerController.signal;
    view.setTimeout(() => {
      document.addEventListener("pointerdown", (event) => {
        const target = event.target as Node | null;
        if (
          target
          && !popoverEl.contains(target)
          && !this.triggerEl.contains(target)
        ) {
          this.close();
        }
      }, { capture: true, signal });
    }, 0);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        this.triggerEl.focus();
      }
    }, { signal });
    const reposition = (): void => {
      if (!this.triggerEl.isConnected) {
        this.close();
        return;
      }
      this.positionPopover(popoverEl, view);
    };
    view.addEventListener("resize", reposition, { signal });
    document.addEventListener("scroll", reposition, {
      capture: true,
      signal,
    });
    searchInputEl.focus({ preventScroll: true });
  }

  private close(): void {
    this.listenerController?.abort();
    this.listenerController = null;
    this.popoverEl?.remove();
    this.popoverEl = null;
    this.triggerEl.setAttribute("aria-expanded", "false");
    this.triggerEl.removeClass("has-focus");
    this.triggerEl.closest<HTMLElement>(".filter-expression")
      ?.removeClass("has-focus");
  }

  private updateLabel(): void {
    const item = this.options.items.find((option) => (
      option.value === this.currentValue
    ));
    this.iconEl.empty();
    if (item?.icon) {
      setIcon(this.iconEl, item.icon);
    }
    this.iconEl.toggleAttribute("hidden", !item?.icon);
    this.labelEl.setText(item?.label ?? this.currentValue ?? "选择选项");
  }

  private positionPopover(popoverEl: HTMLElement, view: Window): void {
    const rect = this.triggerEl.getBoundingClientRect();
    const width = Math.min(360, Math.max(280, rect.width));
    const gap = 6;
    const left = Math.min(
      Math.max(gap, rect.left),
      Math.max(gap, view.innerWidth - width - gap),
    );
    const availableBelow = view.innerHeight - rect.bottom - gap;
    const top = availableBelow >= 260
      ? rect.bottom + gap
      : Math.max(gap, rect.top - 320 - gap);
    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
    popoverEl.style.width = `${width}px`;
  }
}
