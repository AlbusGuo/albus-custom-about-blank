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
  EditorModal,
} from "src/ui/editorModal";

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
  isCustomStatDefinition,
  isOperatorValueOptional,
  type CustomStatDefinition,
  type CustomStatFilterCondition,
  type CustomStatFilterConditionType,
  type CustomStatFilterGroup,
  type CustomStatFilterOperator,
} from "src/utils/customStatFilters";

interface CustomStatEditorModalOptions {
  onChange: (stat: CustomStatDefinition) => Promise<void>;
  onClose?: () => void;
}

export class CustomStatEditorModal {
  private readonly app: App;
  private readonly options: CustomStatEditorModalOptions;
  private draft: CustomStatDefinition;
  private modal: EditorModal | null = null;
  private contentEl: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    initialStat: CustomStatDefinition,
    options: CustomStatEditorModalOptions,
  ) {
    this.app = app;
    this.options = options;
    this.draft = structuredClone(isCustomStatDefinition(initialStat) ? initialStat : createCustomStatDefinition());
  }

  open = (): void => {
    if (this.modal) {
      return;
    }

    this.modal = new EditorModal(this.app, {
      modalClass: "about-blank-stat-editor-modal-shell",
      contentClass: "about-blank-stat-editor-modal",
      onOpen: (contentEl) => {
        this.contentEl = contentEl as HTMLDivElement;
        this.render();
      },
      onClose: () => {
        this.contentEl = null;
        this.bodyEl = null;
        this.modal = null;
        this.options.onClose?.();
      },
    });
    this.modal.open();
  };

  close = (): void => {
    this.modal?.close();
  };

  private render = (): void => {
    if (!this.contentEl) {
      return;
    }

    this.contentEl.empty();

    const metaRowEl = this.contentEl.createDiv({ cls: "about-blank-stat-editor-meta-row" });
    const nameControlEl = this.createInlineField(metaRowEl, "名称");

    const nameInput = nameControlEl.createEl("input", {
      cls: "about-blank-stat-editor-input about-blank-stat-editor-name-input",
      attr: { type: "text", placeholder: "显示名称" },
    });
    nameInput.value = this.draft.displayName;
    nameInput.addEventListener("input", () => {
      this.draft.displayName = nameInput.value;
    });
    nameInput.addEventListener("change", () => {
      void this.commitChanges();
    });

    const conjunctionControlEl = this.createInlineField(metaRowEl, "根组条件");
    const rootConjunctionSelect = conjunctionControlEl.createEl("select", { cls: "about-blank-stat-editor-select" });
    rootConjunctionSelect.addClass("dropdown");
    this.appendConjunctionOptions(rootConjunctionSelect, this.draft.filters.conjunction);
    rootConjunctionSelect.addEventListener("change", () => {
      this.draft.filters.conjunction = rootConjunctionSelect.value as typeof this.draft.filters.conjunction;
      void this.commitChanges();
      this.renderBody();
    });

    this.bodyEl = this.contentEl.createDiv({ cls: "about-blank-stat-editor-body" });
    this.renderBody();
  };

  private renderBody = (): void => {
    if (!this.bodyEl) {
      return;
    }

    const scrollTop = this.bodyEl.scrollTop;
    this.bodyEl.empty();
    this.renderGroup(this.draft.filters, this.bodyEl, true, null, 0, 0);
    this.bodyEl.scrollTop = scrollTop;
  };

  private createInlineField(parentEl: HTMLElement, label: string): HTMLElement {
    const fieldEl = parentEl.createDiv({ cls: "about-blank-stat-editor-inline-field" });
    fieldEl.createDiv({ cls: "about-blank-stat-editor-label", text: label });
    return fieldEl.createDiv({ cls: "about-blank-stat-editor-control" });
  }

  private renderGroup(
    group: CustomStatFilterGroup,
    parentEl: HTMLElement,
    isRoot: boolean,
    parentGroup: CustomStatFilterGroup | null,
    depth: number,
    indexInParent: number,
  ): void {
    if (isRoot) {
      const rootEl = parentEl.createDiv({ cls: "about-blank-stat-editor-root-group" });
      const nodesEl = rootEl.createDiv({ cls: "about-blank-stat-editor-group-nodes" });
      group.conditions.forEach((node, index) => {
        if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group) {
          this.renderGroup(node, nodesEl, false, group, depth + 1, index);
          return;
        }
        this.renderConditionRow(node, nodesEl, group, index);
      });

      const actionsEl = rootEl.createDiv({ cls: "about-blank-stat-editor-actions" });
      this.createTextButton(actionsEl, "添加条件", () => {
        group.conditions.push(createCustomStatFilterCondition());
        this.renderBody();
        void this.commitChanges();
      }, "plus");
      this.createTextButton(actionsEl, "添加条件组", () => {
        group.conditions.push(createCustomStatFilterGroup());
        this.renderBody();
        void this.commitChanges();
      }, "chevrons-right-left");
      return;
    }

    const wrapperEl = parentEl.createDiv({ cls: "about-blank-stat-editor-node about-blank-stat-editor-group-node" });
    wrapperEl.createDiv({
      cls: "about-blank-stat-editor-prefix",
      text: this.getJoinerLabel(parentGroup, indexInParent),
    });

    const groupEl = wrapperEl.createDiv({ cls: "about-blank-stat-editor-group" });
    groupEl.dataset.depth = String(depth);

    const groupHeaderEl = groupEl.createDiv({ cls: "about-blank-stat-editor-group-header" });
    const groupConjunctionSelect = groupHeaderEl.createEl("select", { cls: "about-blank-stat-editor-select" });
    groupConjunctionSelect.addClass("dropdown");
    this.appendConjunctionOptions(groupConjunctionSelect, group.conjunction);
    groupConjunctionSelect.addEventListener("change", () => {
      group.conjunction = groupConjunctionSelect.value as typeof group.conjunction;
      void this.commitChanges();
      this.renderBody();
    });

    if (parentGroup) {
      const removeGroupButton = this.createIconButton(groupHeaderEl, "trash", "删除条件组", () => {
        parentGroup.conditions = parentGroup.conditions.filter((node) => node.id !== group.id);
        this.renderBody();
        void this.commitChanges();
      });
      removeGroupButton.addClass("is-danger");
    }

    const nodesEl = groupEl.createDiv({ cls: "about-blank-stat-editor-group-nodes" });
    group.conditions.forEach((node, index) => {
      if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group) {
        this.renderGroup(node, nodesEl, false, group, depth + 1, index);
        return;
      }
      this.renderConditionRow(node, nodesEl, group, index);
    });

    const actionsEl = groupEl.createDiv({ cls: "about-blank-stat-editor-actions" });
    this.createTextButton(actionsEl, "添加条件", () => {
      group.conditions.push(createCustomStatFilterCondition());
      this.renderBody();
      void this.commitChanges();
    }, "plus");
    this.createTextButton(actionsEl, "添加条件组", () => {
      group.conditions.push(createCustomStatFilterGroup());
      this.renderBody();
      void this.commitChanges();
    }, "chevrons-right-left");
  }

  private renderConditionRow(
    condition: CustomStatFilterCondition,
    parentEl: HTMLElement,
    group: CustomStatFilterGroup,
    indexInGroup: number,
  ): void {
    const wrapperEl = parentEl.createDiv({ cls: "about-blank-stat-editor-node about-blank-stat-editor-condition-node" });
    wrapperEl.createDiv({
      cls: "about-blank-stat-editor-prefix",
      text: this.getJoinerLabel(group, indexInGroup),
    });

    const rowEl = wrapperEl.createDiv({ cls: "about-blank-stat-editor-row" });
    const isValueOptional = isOperatorValueOptional(condition.operator);
    rowEl.toggleClass("is-frontmatter", condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter);
    rowEl.toggleClass("is-value-optional", isValueOptional);

    const typeSelect = rowEl.createEl("select", { cls: "about-blank-stat-editor-select" });
    typeSelect.addClass("dropdown");
    this.appendConditionTypeOptions(typeSelect, condition.type);
    typeSelect.addEventListener("change", () => {
      const nextType = typeSelect.value as CustomStatFilterConditionType;
      condition.type = nextType;
      condition.operator = getDefaultOperatorForConditionType(nextType);
      condition.value = "";
      if (nextType !== CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter) {
        condition.key = "";
      }
      this.renderBody();
      void this.commitChanges();
    });

    if (condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter) {
      const keyInput = rowEl.createEl("input", {
        cls: "about-blank-stat-editor-input about-blank-stat-editor-input-key",
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

    const operatorSelect = rowEl.createEl("select", { cls: "about-blank-stat-editor-select" });
    operatorSelect.addClass("dropdown");
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
      this.renderBody();
      void this.commitChanges();
    });

    if (!isValueOptional) {
      const valueInput = rowEl.createEl("input", {
        cls: "about-blank-stat-editor-input about-blank-stat-editor-input-value",
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
      group.conditions = group.conditions.filter((node) => node.id !== condition.id);
      this.renderBody();
      void this.commitChanges();
    });
    removeButton.addClass("is-danger");
  }

  private async commitChanges(): Promise<void> {
    const nextStat = structuredClone(this.draft);
    this.saveChain = this.saveChain.then(async () => {
      try {
        await this.options.onChange(nextStat);
      } catch (error) {
        loggerOnError(error, "保存自定义统计项目失败\n(About Blank)");
      }
    });
    await this.saveChain;
  }

  private appendConjunctionOptions(selectEl: HTMLSelectElement, currentValue: string): void {
    selectEl.createEl("option", { value: CUSTOM_STAT_FILTER_CONJUNCTIONS.and, text: "满足全部" });
    selectEl.createEl("option", { value: CUSTOM_STAT_FILTER_CONJUNCTIONS.or, text: "满足任一" });
    selectEl.value = currentValue;
  }

  private appendConditionTypeOptions(selectEl: HTMLSelectElement, currentValue: string): void {
    [
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.folder, "文件夹"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType, "文件类型"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName, "文件名"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.tag, "标签"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt, "创建日期"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt, "修改日期"],
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter, "笔记属性"],
    ].forEach(([value, label]) => {
      selectEl.createEl("option", { value, text: label });
    });
    selectEl.value = currentValue;
  }

  private createIconButton(parentEl: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parentEl.createEl("button", {
      cls: "about-blank-stat-editor-icon-button",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private createTextButton(parentEl: HTMLElement, label: string, onClick: () => void, icon?: string): HTMLButtonElement {
    const button = parentEl.createEl("button", {
      cls: "about-blank-stat-editor-text-button",
      attr: { type: "button" },
    });
    if (icon) {
      const iconEl = button.createSpan({ cls: "about-blank-stat-editor-text-button-icon" });
      setIcon(iconEl, icon);
    }
    button.createSpan({ text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  private getJoinerLabel(group: CustomStatFilterGroup | null, index: number): string {
    if (index === 0 || !group) {
      return "条件";
    }
    return group.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.and ? "并且" : "或者";
  }

  private getValueInputType(condition: CustomStatFilterCondition): string {
    if (condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt || condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt) {
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
  }

  private getValuePlaceholder(condition: CustomStatFilterCondition): string {
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
  }

  private getOperatorLabel(operator: CustomStatFilterOperator): string {
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
  }
}