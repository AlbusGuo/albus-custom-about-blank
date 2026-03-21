import {
  type App,
  setIcon,
} from "obsidian";

import {
  loggerOnError,
} from "src/commons";

import {
  ExtensionSuggester,
} from "src/ui/extensionSuggester";

import {
  FolderSuggester,
} from "src/ui/folderSuggester";

import {
  createCustomStatDefinition,
  createCustomStatFilterCondition,
  createCustomStatFilterGroup,
  CUSTOM_STAT_FILTER_CONDITION_TYPES,
  CUSTOM_STAT_FILTER_CONJUNCTIONS,
  CUSTOM_STAT_FILTER_NODE_KINDS,
  CUSTOM_STAT_FILTER_OPERATORS,
  getDefaultOperatorForConditionType,
  getOperatorsForConditionType,
  isDateConditionType,
  isOperatorValueOptional,
  normalizeCustomStatDefinition,
  type CustomStatDefinition,
  type CustomStatFilterCondition,
  type CustomStatFilterConditionType,
  type CustomStatFilterGroup,
  type CustomStatFilterOperator,
} from "src/utils/customStatFilters";

interface CustomStatEditorPopoverOptions {
  anchorEl: HTMLElement;
  title: string;
  onChange: (stat: CustomStatDefinition) => Promise<void>;
  onClose?: () => void;
}

export class CustomStatEditorPopover {
  private readonly app: App;
  private readonly options: CustomStatEditorPopoverOptions;
  private draft: CustomStatDefinition;
  private popoverEl: HTMLDivElement | null = null;
  private contentEl: HTMLDivElement | null = null;
  private cleanupCallbacks: Array<() => void> = [];
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    initialStat: CustomStatDefinition,
    options: CustomStatEditorPopoverOptions,
  ) {
    this.app = app;
    this.options = options;
    this.draft = structuredClone(normalizeCustomStatDefinition(initialStat) ?? createCustomStatDefinition());
  }

  open = (): void => {
    if (this.popoverEl) {
      this.updateAnchor(this.options.anchorEl);
      return;
    }

    const mountRoot = this.options.anchorEl.closest(".modal-container")
      ?? this.options.anchorEl.closest(".modal")
      ?? this.options.anchorEl.ownerDocument.body;

    this.popoverEl = mountRoot.createDiv({ cls: "about-blank-stat-popover" });
    this.popoverEl.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    this.contentEl = this.popoverEl.createDiv({ cls: "about-blank-stat-popover-content" });
    this.render();

    const ownerDocument = this.options.anchorEl.ownerDocument;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (target instanceof HTMLElement && target.closest(".suggestion-container")) {
        return;
      }
      if (this.popoverEl?.contains(target) || this.options.anchorEl.contains(target)) {
        return;
      }
      this.close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        this.close();
      }
    };
    const handleWindowChange = () => {
      this.position();
    };

    ownerDocument.addEventListener("mousedown", handlePointerDown, true);
    ownerDocument.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    this.cleanupCallbacks.push(() => {
      ownerDocument.removeEventListener("mousedown", handlePointerDown, true);
      ownerDocument.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    });

    requestAnimationFrame(() => {
      this.position();
    });
  };

  close = (): void => {
    this.cleanupCallbacks.forEach((cleanup) => cleanup());
    this.cleanupCallbacks = [];
    this.popoverEl?.remove();
    this.popoverEl = null;
    this.contentEl = null;
    this.options.onClose?.();
  };

  updateAnchor = (anchorEl: HTMLElement): void => {
    this.options.anchorEl = anchorEl;
    this.position();
  };
  
  private updateTitle = (): void => {
    const titleEl = this.contentEl?.querySelector<HTMLElement>(".about-blank-stat-popover-title");
    titleEl?.setText(this.draft.displayName.trim() || this.options.title);
  };

  private render = (): void => {
    if (!this.contentEl) {
      return;
    }

    this.contentEl.empty();

    const headerEl = this.contentEl.createDiv({ cls: "about-blank-stat-popover-header" });
    const titleEl = headerEl.createDiv({ cls: "about-blank-stat-popover-title" });
    titleEl.setText(this.draft.displayName.trim() || this.options.title);

    const closeButton = headerEl.createEl("button", {
      cls: "about-blank-stat-popover-close",
      attr: { type: "button", "aria-label": "关闭" },
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", () => {
      this.close();
    });

    const topRowEl = this.contentEl.createDiv({ cls: "about-blank-stat-popover-top-row" });

    const nameInput = topRowEl.createEl("input", {
      cls: "about-blank-stat-popover-input about-blank-stat-popover-name-input",
      attr: { type: "text", placeholder: "显示名称" },
    });
    nameInput.value = this.draft.displayName;
    nameInput.addEventListener("input", () => {
      this.draft.displayName = nameInput.value;
      this.updateTitle();
    });
    nameInput.addEventListener("change", () => {
      void this.commitChanges();
    });

    const rootConjunctionSelect = topRowEl.createEl("select", { cls: "about-blank-stat-popover-select" });
    this.appendConjunctionOptions(rootConjunctionSelect, this.draft.filters.conjunction);
    rootConjunctionSelect.addEventListener("change", () => {
      this.draft.filters.conjunction = rootConjunctionSelect.value as typeof this.draft.filters.conjunction;
      void this.commitChanges();
      this.render();
    });

    const bodyEl = this.contentEl.createDiv({ cls: "about-blank-stat-popover-body" });
    this.renderGroup(this.draft.filters, bodyEl, true, null, 0);
  };

  private renderGroup = (
    group: CustomStatFilterGroup,
    parentEl: HTMLElement,
    isRoot: boolean,
    parentGroup: CustomStatFilterGroup | null,
    depth: number,
  ): void => {
    const groupEl = parentEl.createDiv({ cls: "about-blank-stat-popover-group" });
    groupEl.dataset.depth = String(depth);

    if (!isRoot) {
      const groupRowEl = groupEl.createDiv({ cls: "about-blank-stat-popover-group-row" });
      groupRowEl.createDiv({
        cls: "about-blank-stat-popover-group-label",
        text: group.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.and ? "条件组: 全部" : "条件组: 任一",
      });

      const groupConjunctionSelect = groupRowEl.createEl("select", { cls: "about-blank-stat-popover-select" });
      this.appendConjunctionOptions(groupConjunctionSelect, group.conjunction);
      groupConjunctionSelect.addEventListener("change", () => {
        group.conjunction = groupConjunctionSelect.value as typeof group.conjunction;
        void this.commitChanges();
        this.render();
      });

      this.createIconButton(groupRowEl, "plus", "添加条件", () => {
        group.conditions.push(createCustomStatFilterCondition());
        this.render();
        void this.commitChanges();
      });
      this.createIconButton(groupRowEl, "list-tree", "添加条件组", () => {
        group.conditions.push(createCustomStatFilterGroup());
        this.render();
        void this.commitChanges();
      });

      if (parentGroup) {
        const removeGroupButton = this.createIconButton(groupRowEl, "trash", "删除条件组", () => {
          if (parentGroup.conditions.length <= 1) {
            return;
          }
          parentGroup.conditions = parentGroup.conditions.filter((node) => node.id !== group.id);
          this.render();
          void this.commitChanges();
        });
        removeGroupButton.addClass("is-danger");
        removeGroupButton.toggleClass("is-disabled", parentGroup.conditions.length <= 1);
        removeGroupButton.disabled = parentGroup.conditions.length <= 1;
      }
    }

    const nodesEl = groupEl.createDiv({ cls: "about-blank-stat-popover-group-nodes" });
    group.conditions.forEach((node) => {
      if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group) {
        this.renderGroup(node, nodesEl, false, group, depth + 1);
        return;
      }
      this.renderConditionRow(node, nodesEl, group);
    });

    if (isRoot) {
      const actionsEl = groupEl.createDiv({ cls: "about-blank-stat-popover-actions" });
      this.createTextButton(actionsEl, "+ 条件", () => {
        group.conditions.push(createCustomStatFilterCondition());
        this.render();
        void this.commitChanges();
      });
      this.createTextButton(actionsEl, "+ 条件组", () => {
        group.conditions.push(createCustomStatFilterGroup());
        this.render();
        void this.commitChanges();
      });
    }
  };

  private renderConditionRow = (
    condition: CustomStatFilterCondition,
    parentEl: HTMLElement,
    group: CustomStatFilterGroup,
  ): void => {
    const rowEl = parentEl.createDiv({ cls: "about-blank-stat-popover-row" });

    const typeSelect = rowEl.createEl("select", { cls: "about-blank-stat-popover-select" });
    this.appendConditionTypeOptions(typeSelect, condition.type);
    typeSelect.addEventListener("change", () => {
      const nextType = typeSelect.value as CustomStatFilterConditionType;
      condition.type = nextType;
      condition.operator = getDefaultOperatorForConditionType(nextType);
      condition.value = "";
      if (nextType !== CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter) {
        condition.key = "";
      }
      this.render();
      void this.commitChanges();
    });

    if (condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter) {
      const keyInput = rowEl.createEl("input", {
        cls: "about-blank-stat-popover-input about-blank-stat-popover-input-key",
        attr: { type: "text", placeholder: "字段" },
      });
      keyInput.value = condition.key;
      keyInput.addEventListener("input", () => {
        condition.key = keyInput.value;
      });
      keyInput.addEventListener("change", () => {
        void this.commitChanges();
      });
    }

    const operatorSelect = rowEl.createEl("select", { cls: "about-blank-stat-popover-select" });
    const operators = getOperatorsForConditionType(condition.type);
    operators.forEach((operator) => {
      operatorSelect.createEl("option", {
        value: operator,
        text: this.getOperatorLabel(operator),
      });
    });
    operatorSelect.value = operators.includes(condition.operator)
      ? condition.operator
      : getDefaultOperatorForConditionType(condition.type);
    operatorSelect.addEventListener("change", () => {
      condition.operator = operatorSelect.value as CustomStatFilterOperator;
      if (isOperatorValueOptional(condition.operator)) {
        condition.value = "";
      }
      this.render();
      void this.commitChanges();
    });

    if (!isOperatorValueOptional(condition.operator)) {
      const valueInput = rowEl.createEl("input", {
        cls: "about-blank-stat-popover-input about-blank-stat-popover-input-value",
        attr: {
          type: this.getValueInputType(condition),
          placeholder: this.getValuePlaceholder(condition),
        },
      });
      valueInput.value = condition.value;
      valueInput.addEventListener("input", () => {
        condition.value = valueInput.value;
      });
      valueInput.addEventListener("change", () => {
        void this.commitChanges();
      });

      if (condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.folder) {
        new FolderSuggester(this.app, valueInput);
      } else if (condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType) {
        new ExtensionSuggester(this.app, valueInput);
      }
    }

    const removeButton = this.createIconButton(rowEl, "trash", "删除条件", () => {
      if (group.conditions.length <= 1) {
        return;
      }
      group.conditions = group.conditions.filter((node) => node.id !== condition.id);
      this.render();
      void this.commitChanges();
    });
    removeButton.addClass("is-danger");
    removeButton.toggleClass("is-disabled", group.conditions.length <= 1);
    removeButton.disabled = group.conditions.length <= 1;
  };

  private position = (): void => {
    if (!this.popoverEl) {
      return;
    }
    if (!this.options.anchorEl.isConnected) {
      this.close();
      return;
    }

    const anchorRect = this.options.anchorEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxWidth = Math.min(640, viewportWidth - 24);

    this.popoverEl.style.maxWidth = `${maxWidth}px`;
    this.popoverEl.style.width = `${Math.min(Math.max(anchorRect.width, 520), maxWidth)}px`;

    const popoverRect = this.popoverEl.getBoundingClientRect();
    const belowTop = anchorRect.bottom + 6;
    const canPlaceBelow = belowTop + popoverRect.height <= viewportHeight - 12;
    const top = canPlaceBelow
      ? Math.min(belowTop, viewportHeight - popoverRect.height - 12)
      : Math.max(12, anchorRect.top - popoverRect.height - 6);
    const left = Math.min(
      Math.max(12, anchorRect.left),
      viewportWidth - popoverRect.width - 12,
    );

    this.popoverEl.style.top = `${top}px`;
    this.popoverEl.style.left = `${left}px`;
  };

  private commitChanges = async (): Promise<void> => {
    const normalized = normalizeCustomStatDefinition(this.draft) ?? createCustomStatDefinition();
    const nextStat = structuredClone(normalized);
    this.updateTitle();
    this.saveChain = this.saveChain.then(async () => {
      try {
        await this.options.onChange(nextStat);
      } catch (error) {
        loggerOnError(error, "保存自定义统计项目失败\n(About Blank)");
      }
    });
    await this.saveChain;
    requestAnimationFrame(() => {
      this.position();
    });
  };

  private appendConjunctionOptions = (selectEl: HTMLSelectElement, currentValue: string): void => {
    selectEl.createEl("option", { value: CUSTOM_STAT_FILTER_CONJUNCTIONS.and, text: "满足全部" });
    selectEl.createEl("option", { value: CUSTOM_STAT_FILTER_CONJUNCTIONS.or, text: "满足任一" });
    selectEl.value = currentValue;
  };

  private appendConditionTypeOptions = (selectEl: HTMLSelectElement, currentValue: string): void => {
    [
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.folder, "文件夹"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType, "文件类型"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName, "文件名"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.tag, "标签"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt, "创建日期"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt, "修改日期"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter, "Frontmatter"],
    ].forEach(([value, label]) => {
      selectEl.createEl("option", { value, text: label });
    });
    selectEl.value = currentValue;
  };

  private createIconButton = (
    parentEl: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = parentEl.createEl("button", {
      cls: "about-blank-stat-popover-icon-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  };

  private createTextButton = (
    parentEl: HTMLElement,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement => {
    const button = parentEl.createEl("button", {
      cls: "about-blank-stat-popover-text-button",
      text: label,
      attr: { type: "button" },
    });
    button.addEventListener("click", onClick);
    return button;
  };

  private getValueInputType = (condition: CustomStatFilterCondition): string => {
    if (isDateConditionType(condition.type)) {
      return "date";
    }
    if (
      condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter
      && (
        condition.operator === CUSTOM_STAT_FILTER_OPERATORS.before
        || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.onOrBefore
        || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.after
        || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.onOrAfter
      )
    ) {
      return "date";
    }
    return "text";
  };

  private getValuePlaceholder = (condition: CustomStatFilterCondition): string => {
    switch (condition.type) {
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.folder:
        return "文件夹路径";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType:
        return "例如 md";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.tag:
        return "标签";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName:
        return "文件名";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt:
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt:
        return "日期";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter:
        return "比较值";
      default:
        return "值";
    }
  };

  private getOperatorLabel = (operator: CustomStatFilterOperator): string => {
    switch (operator) {
      case CUSTOM_STAT_FILTER_OPERATORS.is:
        return "等于";
      case CUSTOM_STAT_FILTER_OPERATORS.isNot:
        return "不等于";
      case CUSTOM_STAT_FILTER_OPERATORS.contains:
        return "包含";
      case CUSTOM_STAT_FILTER_OPERATORS.notContains:
        return "不包含";
      case CUSTOM_STAT_FILTER_OPERATORS.startsWith:
        return "开头是";
      case CUSTOM_STAT_FILTER_OPERATORS.endsWith:
        return "结尾是";
      case CUSTOM_STAT_FILTER_OPERATORS.regexMatch:
        return "正则匹配";
      case CUSTOM_STAT_FILTER_OPERATORS.before:
        return "早于";
      case CUSTOM_STAT_FILTER_OPERATORS.onOrBefore:
        return "早于或等于";
      case CUSTOM_STAT_FILTER_OPERATORS.after:
        return "晚于";
      case CUSTOM_STAT_FILTER_OPERATORS.onOrAfter:
        return "晚于或等于";
      case CUSTOM_STAT_FILTER_OPERATORS.exists:
        return "存在";
      case CUSTOM_STAT_FILTER_OPERATORS.notExists:
        return "不存在";
      default:
        return operator;
    }
  };
}