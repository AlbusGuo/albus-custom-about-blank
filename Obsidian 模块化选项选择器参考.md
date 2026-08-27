# Obsidian 模块化选项选择器参考

本文提供一个可跨插件复用的固定选项选择器, 包含两个版本:

- `SimpleOptionPicker`: 不带搜索框, 适合 2 至 10 个固定选项。
- `SearchableOptionPicker`: 带搜索框和模糊匹配, 适合字段、命令、图标等较长列表。

两种版本共用相同的数据结构、触发器、候选项、键盘操作、浮层定位和销毁逻辑。

实现只依赖 Obsidian API 和 DOM API, 不依赖 React、第三方浮层库或 Bases 内部构造器。

## 1. 交互边界

固定选项不应直接使用可编辑输入框。推荐结构为:

```text
只读触发器
  当前选项图标
  当前选项名称
  展开图标

候选浮层
  可选搜索框
  候选列表
    图标
    名称
    辅助 ID
    当前项勾选
```

搜索框仅用于过滤候选项。用户输入的搜索文字不能写入插件设置。

## 2. 数据结构

```ts
export interface OptionPickerItem {
  value: string;
  label: string;
  icon?: string;
  keywords?: string[];
}

export interface OptionPickerOptions {
  items: OptionPickerItem[];
  value: string;
  ariaLabel: string;
  className?: string;
  onChange: (value: string, item: OptionPickerItem) => void;
}
```

字段含义:

- `value`: 实际保存值, 如 `note.author`.
- `label`: 用户看到的名称, 如 `author`.
- `icon`: 可选 Lucide 图标 ID.
- `keywords`: 额外搜索关键词。
- `onChange`: 只在用户选择合法候选项后调用。

## 3. TypeScript 实现

建议保存为 `src/ui/optionPicker.ts`.

```ts
import {
  prepareFuzzySearch,
  setIcon,
} from "obsidian";

export interface OptionPickerItem {
  value: string;
  label: string;
  icon?: string;
  keywords?: string[];
}

export interface OptionPickerOptions {
  items: OptionPickerItem[];
  value: string;
  ariaLabel: string;
  className?: string;
  onChange: (value: string, item: OptionPickerItem) => void;
}

const MAX_VISIBLE_OPTIONS = 100;

abstract class BaseOptionPicker {
  readonly triggerEl: HTMLButtonElement;

  private readonly iconEl: HTMLSpanElement;
  private readonly labelEl: HTMLSpanElement;
  private readonly chevronEl: HTMLSpanElement;
  private items: OptionPickerItem[];
  private currentValue: string;
  private popoverEl: HTMLElement | null = null;
  private listenerController: AbortController | null = null;

  protected constructor(
    parentEl: HTMLElement,
    private readonly options: OptionPickerOptions,
    private readonly searchable: boolean,
  ) {
    this.items = [...options.items];
    this.currentValue = options.value;

    this.triggerEl = parentEl.createEl("button", {
      cls: [
        "combobox-button",
        "modular-option-picker-trigger",
        ...(options.className?.split(/\s+/).filter(Boolean) ?? []),
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
    this.chevronEl = this.triggerEl.createSpan({
      cls: "combobox-button-chevron",
    });
    setIcon(this.chevronEl, "chevrons-up-down");

    this.updateTrigger();
    this.triggerEl.addEventListener("click", this.toggle);
  }

  setItems(items: OptionPickerItem[]): void {
    this.items = [...items];
    this.updateTrigger();
    this.close();
  }

  setValue(value: string): void {
    this.currentValue = value;
    this.updateTrigger();
  }

  getValue(): string {
    return this.currentValue;
  }

  destroy(): void {
    this.close();
    this.triggerEl.removeEventListener("click", this.toggle);
  }

  private toggle = (): void => {
    if (this.popoverEl) {
      this.close();
    } else {
      this.open();
    }
  };

  private open(): void {
    const document = this.triggerEl.ownerDocument;
    const view = document.defaultView;
    if (!view) {
      return;
    }

    // 挂载到 Modal 内部可避免 Obsidian 焦点约束把焦点抢回第一个输入框。
    const hostEl = this.triggerEl.closest<HTMLElement>(".modal")
      ?? document.body;

    const popoverEl = hostEl.createDiv({
      cls: [
        "combobox",
        "suggestion-container",
        this.searchable ? "has-input-focus" : "",
        "modular-option-picker-popover",
      ].filter(Boolean),
      attr: { role: "dialog" },
    });

    this.popoverEl = popoverEl;
    this.triggerEl.setAttribute("aria-expanded", "true");
    this.triggerEl.addClass("has-focus");
    this.triggerEl.closest<HTMLElement>(".filter-expression")
      ?.addClass("has-focus");

    let searchInputEl: HTMLInputElement | null = null;
    if (this.searchable) {
      const searchEl = popoverEl.createDiv({
        cls: "search-input-container",
      });
      searchInputEl = searchEl.createEl("input", {
        attr: {
          type: "search",
          placeholder: "输入并开始搜索...",
          autocomplete: "off",
        },
      });
    }

    const listEl = popoverEl.createDiv({
      cls: "suggestion",
      attr: { role: "listbox" },
    });

    let optionElements: HTMLElement[] = [];
    let activeIndex = -1;

    const updateActiveItem = (): void => {
      optionElements.forEach((element, index) => {
        element.classList.toggle("is-selected", index === activeIndex);
      });
      optionElements[activeIndex]?.scrollIntoView({ block: "nearest" });
    };

    const selectItem = (item: OptionPickerItem): void => {
      this.currentValue = item.value;
      this.updateTrigger();
      this.options.onChange(item.value, item);
      this.close();
    };

    const renderItems = (): void => {
      const query = searchInputEl?.value.trim() ?? "";
      const search = query ? prepareFuzzySearch(query) : null;

      const visibleItems = this.items
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
      optionElements = [];
      activeIndex = -1;

      if (visibleItems.length === 0) {
        listEl.createDiv({
          cls: "suggestion-empty",
          text: "没有匹配的选项",
        });
        return;
      }

      visibleItems.forEach((item) => {
        const itemEl = listEl.createDiv({
          cls: ["suggestion-item", "mod-complex"],
          attr: {
            role: "option",
            tabindex: "0",
            "aria-selected": String(item.value === this.currentValue),
          },
        });

        if (item.icon) {
          const iconWrapEl = itemEl.createSpan({ cls: "suggestion-icon" });
          const flairEl = iconWrapEl.createSpan({ cls: "suggestion-flair" });
          setIcon(flairEl, item.icon);
        }

        const contentEl = itemEl.createDiv({ cls: "suggestion-content" });
        contentEl.createDiv({
          cls: "suggestion-title",
          text: item.label,
        });

        const auxEl = itemEl.createSpan({ cls: "suggestion-aux" });
        if (item.value !== item.label) {
          auxEl.createSpan({
            cls: "modular-option-picker-value",
            text: item.value,
          });
        }

        // 只有选中项创建勾选元素。未选中项不预留勾选列。
        if (item.value === this.currentValue) {
          const selectedEl = auxEl.createSpan({ cls: "suggestion-flair" });
          setIcon(selectedEl, "check");
        }

        itemEl.addEventListener("click", () => selectItem(item));
        itemEl.addEventListener("mouseenter", () => {
          activeIndex = optionElements.indexOf(itemEl);
          updateActiveItem();
        });
        itemEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectItem(item);
          }
        });
        optionElements.push(itemEl);
      });
    };

    const keyboardTarget = searchInputEl ?? popoverEl;
    if (!searchInputEl) {
      popoverEl.tabIndex = -1;
    }
    keyboardTarget.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex = Math.min(optionElements.length - 1, activeIndex + 1);
        updateActiveItem();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = Math.max(0, activeIndex - 1);
        updateActiveItem();
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        optionElements[activeIndex]?.click();
      }
    });

    searchInputEl?.addEventListener("input", renderItems);
    renderItems();
    this.positionPopover(popoverEl, view);
    this.registerTransientListeners(popoverEl, view);

    if (searchInputEl) {
      searchInputEl.focus({ preventScroll: true });
    } else {
      popoverEl.focus({ preventScroll: true });
    }
  }

  private registerTransientListeners(
    popoverEl: HTMLElement,
    view: Window,
  ): void {
    const document = this.triggerEl.ownerDocument;
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

  private updateTrigger(): void {
    const item = this.items.find((option) => (
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

export class SimpleOptionPicker extends BaseOptionPicker {
  constructor(parentEl: HTMLElement, options: OptionPickerOptions) {
    super(parentEl, options, false);
  }
}

export class SearchableOptionPicker extends BaseOptionPicker {
  constructor(parentEl: HTMLElement, options: OptionPickerOptions) {
    super(parentEl, options, true);
  }
}
```

## 4. 最小 CSS

保存到插件 CSS 中。主要样式由 Obsidian 自带的 `combobox-*` 和 `suggestion-*` 类提供, 这里只补充浮层定位和辅助 ID 限制。

```css
.modular-option-picker-popover {
  position: fixed;
  z-index: var(--layer-popover, 10000);
  max-height: min(320px, 50vh);
}

.modular-option-picker-value {
  max-width: 140px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

如果希望完全独立于 Obsidian 当前主题实现, 可以再为 `.combobox-button` 和 `.suggestion-container` 添加回退样式, 但一般不建议覆盖官方样式。

## 5. 无搜索版本调用

适合组关系、布尔值、排序方向等少量固定选项。

```ts
import {
  SimpleOptionPicker,
} from "src/ui/optionPicker";

const picker = new SimpleOptionPicker(containerEl, {
  value: settings.join,
  ariaLabel: "选择条件关系",
  items: [
    { value: "and", label: "满足以下全部条件" },
    { value: "or", label: "满足以下任意条件" },
    { value: "not", label: "不满足以下任何条件" },
  ],
  onChange: async (value) => {
    settings.join = value;
    await plugin.saveSettings();
  },
});

plugin.register(() => picker.destroy());
```

## 6. 带搜索版本调用

适合属性、命令、文件和图标选择。

```ts
import {
  SearchableOptionPicker,
} from "src/ui/optionPicker";

const picker = new SearchableOptionPicker(containerEl, {
  value: settings.property,
  ariaLabel: "选择属性",
  className: "filter-property-select",
  items: [
    {
      value: "file.path",
      label: "文件路径",
      icon: "folder-tree",
      keywords: ["文件", "路径"],
    },
    {
      value: "file.extension",
      label: "扩展名",
      icon: "file-type",
      keywords: ["文件", "类型"],
    },
    {
      value: "note.author",
      label: "author",
      icon: "text",
      keywords: ["笔记属性"],
    },
  ],
  onChange: async (value) => {
    settings.property = value;
    await plugin.saveSettings();
  },
});

plugin.register(() => picker.destroy());
```

## 7. 动态更新

如果选项会在运行时变化:

```ts
picker.setItems(nextItems);
picker.setValue(nextValue);
```

更新选项时会自动关闭已经打开的浮层, 防止候选列表与数据源不同步。

## 8. Modal 中使用

选择器会优先把浮层挂载到当前 `.modal` 中:

```ts
const hostEl = triggerEl.closest<HTMLElement>(".modal")
  ?? triggerEl.ownerDocument.body;
```

这样可以避免 Obsidian Modal 焦点约束把搜索框焦点强制送回 Modal 内第一个输入框。

浮层打开时应给外层条件框添加 `has-focus`, 关闭时删除:

```ts
triggerEl.closest<HTMLElement>(".filter-expression")
  ?.addClass("has-focus");
```

## 9. 键盘交互

推荐支持:

- `ArrowDown`: 选择下一项。
- `ArrowUp`: 选择上一项。
- `Enter`: 确认当前高亮项。
- `Space`: 在候选项获得焦点时确认。
- `Escape`: 关闭浮层并把焦点返回触发器。
- 点击外部: 关闭浮层。

候选高亮应使用 Obsidian 官方 `is-selected` 类。

## 10. 勾选布局

不要为每个候选项预先创建空勾选元素。错误做法会产生贯穿列表的独立勾选列。

正确做法是只在当前选中项中创建勾选图标:

```ts
if (item.value === currentValue) {
  const selectedEl = auxEl.createSpan({ cls: "suggestion-flair" });
  setIcon(selectedEl, "check");
}
```

这样勾选仅参与选中行的 flex 布局, 只把该行内容向左推动。

## 11. 官方 Bases 条件行结构

如果选择器用于筛选器, 推荐沿用官方结构:

```text
bases-query-container
  filter-group
    filter-group-header
    filter-group-statements
      filter-row
        conjunction
        filter-statement
          filter-expression metadata-property
            filter-lhs-container
              combobox-button filter-property-select
            combobox-button filter-operator
            filter-rhs-container metadata-property-value
            filter-row-actions
    filter-group-actions
```

关键点:

- `metadata-property` 提供整行外框、背景和 hover.
- `filter-lhs-container` 包含字段选择器。
- `filter-operator` 提供中间分隔线。
- `metadata-property-value` 负责值编辑区域。
- `filter-row-actions` 必须位于条件框内部。

## 12. 常见错误

### 把固定选项做成输入框

问题: 用户可以输入无效值, UI 与实际配置不同步。

解决: 使用只读触发器, 搜索框只存在于浮层内部。

### 把浮层挂载到 Modal 外部

问题: Obsidian 会把焦点强制送回 Modal 内第一个输入框。

解决: 优先挂载到 `triggerEl.closest(".modal")`.

### 滚动时关闭浮层

问题: 搜索框自动聚焦可能触发滚动, 浮层刚打开就关闭。

解决: 滚动时重新定位浮层, 不要直接关闭。

### 所有候选项预留勾选空间

问题: 形成独立勾选列, 候选内容整体错位。

解决: 只为当前选中项创建勾选元素。

### 只复制官方类名

问题: 缺少 `metadata-property`、左右容器或正确层级时, 官方 CSS 不会生效。

解决: 同时复用完整 DOM 层级和类结构。

## 13. 移植检查清单

- [ ] 固定选项不能通过搜索文字直接写入配置。
- [ ] 带搜索版和无搜索版共用同一触发器结构。
- [ ] 选择器能够在 Modal 内正确聚焦。
- [ ] 点击外部和 Escape 能关闭。
- [ ] 滚动和窗口变化后浮层位置正确。
- [ ] 候选列表最多渲染合理数量。
- [ ] 选项支持图标、名称、辅助 ID 和关键词。
- [ ] 只有当前项创建勾选元素。
- [ ] 销毁组件时删除浮层和全局监听器。
- [ ] 使用 `setIcon`, 不手写 SVG.
- [ ] 不使用 `innerHTML`.
- [ ] 不使用 `transition: all`.
