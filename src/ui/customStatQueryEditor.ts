import {
  type App,
  setIcon,
  setTooltip,
} from "obsidian";

import {
  CustomStatFieldCatalog,
} from "src/utils/customStatFieldCatalog";

import {
  createCustomStatFilterCondition,
  createCustomStatFilterGroup,
  CUSTOM_STAT_FILTER_CONJUNCTIONS,
  CUSTOM_STAT_FILTER_NODE_KINDS,
  CUSTOM_STAT_FILTER_OPERATORS,
  getDefaultOperatorForFieldType,
  getOperatorsForFieldType,
  isOperatorValueOptional,
  type CustomStatFieldType,
  type CustomStatFilterCondition,
  type CustomStatFilterGroup,
  type CustomStatFilterOperator,
} from "src/utils/customStatQuery";

import {
  ValueSuggester,
} from "src/ui/valueSuggester";

import {
  OptionPicker,
  type OptionPickerItem,
} from "src/ui/optionPicker";

interface CustomStatQueryEditorOptions {
  onChange: () => void;
}

export class CustomStatQueryEditor {
  private readonly catalog: CustomStatFieldCatalog;
  private containerEl: HTMLElement | null = null;
  private readonly optionPickers = new Set<OptionPicker>();

  constructor(
    private readonly app: App,
    private readonly root: CustomStatFilterGroup,
    private readonly options: CustomStatQueryEditorOptions,
  ) {
    this.catalog = new CustomStatFieldCatalog(app);
  }

  mount(containerEl: HTMLElement): void {
    this.containerEl = containerEl;
    this.render();
  }

  destroy(): void {
    this.destroyOptionPickers();
    this.containerEl = null;
  }

  private render(): void {
    if (!this.containerEl) {
      return;
    }
    const scrollEl = this.containerEl.closest<HTMLElement>(
      ".about-blank-stat-editor-modal",
    );
    const previousScrollTop = scrollEl?.scrollTop ?? 0;
    this.destroyOptionPickers();
    this.containerEl.empty();
    this.containerEl.addClass(
      "about-blank-filter-editor",
      "bases-query-container",
    );
    if (this.root.conditions.length === 0) {
      const emptyEl = this.containerEl.createDiv({
        cls: "about-blank-filter-editor-empty",
      });
      emptyEl.createDiv({
        cls: "about-blank-filter-editor-empty-label",
        text: "还没有筛选条件",
      });
      this.renderAddActions(
        emptyEl.createDiv({ cls: "about-blank-filter-editor-empty-footer" }),
        this.root,
      );
      this.restoreScrollPosition(scrollEl, previousScrollTop);
      return;
    }
    this.renderGroup(this.root, this.containerEl, true, null);
    this.restoreScrollPosition(scrollEl, previousScrollTop);
  }

  private restoreScrollPosition(
    scrollEl: HTMLElement | null,
    scrollTop: number,
  ): void {
    if (!scrollEl) {
      return;
    }
    scrollEl.scrollTop = scrollTop;
    scrollEl.win.requestAnimationFrame(() => {
      if (scrollEl.isConnected) {
        scrollEl.scrollTop = scrollTop;
      }
    });
  }

  private renderGroup(
    group: CustomStatFilterGroup,
    parentEl: HTMLElement,
    isRoot: boolean,
    parentGroup: CustomStatFilterGroup | null,
  ): void {
    const groupEl = parentEl.createDiv({
      cls: "filter-group about-blank-filter-group",
    });
    groupEl.dataset.root = String(isRoot);
    const headerEl = groupEl.createDiv({
      cls: "filter-group-header about-blank-filter-group-header",
    });
    const joinSelect = headerEl.createEl("select", {
      cls: "conjunction dropdown",
    });
    joinSelect.createEl("option", {
      value: CUSTOM_STAT_FILTER_CONJUNCTIONS.and,
      text: "满足以下全部条件",
    });
    joinSelect.createEl("option", {
      value: CUSTOM_STAT_FILTER_CONJUNCTIONS.or,
      text: "满足以下任意条件",
    });
    joinSelect.createEl("option", {
      value: CUSTOM_STAT_FILTER_CONJUNCTIONS.not,
      text: "不满足以下任何条件",
    });
    joinSelect.value = group.conjunction;
    joinSelect.addEventListener("change", () => {
      group.conjunction = joinSelect.value === CUSTOM_STAT_FILTER_CONJUNCTIONS.or
        ? CUSTOM_STAT_FILTER_CONJUNCTIONS.or
        : joinSelect.value === CUSTOM_STAT_FILTER_CONJUNCTIONS.not
          ? CUSTOM_STAT_FILTER_CONJUNCTIONS.not
          : CUSTOM_STAT_FILTER_CONJUNCTIONS.and;
      this.options.onChange();
      this.render();
    });

    if (parentGroup) {
      const headerActionsEl = headerEl.createDiv({
        cls: "filter-group-header-actions",
      });
      this.createIconButton(
        headerActionsEl,
        "trash-2",
        "删除条件组",
        "about-blank-filter-group-remove",
        () => {
          this.removeNode(group.id);
          this.options.onChange();
          this.render();
        },
      );
    }

    if (group.conditions.length > 0) {
      const childrenEl = groupEl.createDiv({
        cls: "filter-group-statements about-blank-filter-group-children",
      });
      group.conditions.forEach((node, index) => {
        const rowEl = childrenEl.createDiv({
          cls: "filter-row about-blank-filter-item-row",
        });
        const conjunction = index === 0
          ? "条件"
          : group.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.or
            ? "或者"
            : group.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.not
              ? "并且不"
              : "并且";
        rowEl.createSpan({ cls: "conjunction", text: conjunction });
        if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group) {
          rowEl.addClass("mod-group");
          this.renderGroup(node, rowEl, false, group);
        } else {
          this.renderCondition(node, rowEl);
        }
      });
    }
    this.renderAddActions(
      groupEl.createDiv({
        cls: "filter-group-actions about-blank-filter-group-footer",
      }),
      group,
    );
  }

  private renderCondition(
    condition: CustomStatFilterCondition,
    parentEl: HTMLElement,
  ): void {
    const statementEl = parentEl.createDiv({
      cls: "filter-statement",
    });
    statementEl.dataset.conditionId = condition.id;
    const contentEl = statementEl.createDiv({
      cls: "filter-expression metadata-property about-blank-filter-item-content",
    });
    const actionEl = contentEl.createDiv({
      cls: "filter-row-actions about-blank-filter-item-action",
    });
    const fieldType = this.catalog.getFieldType(condition.field);

    const leftInputEl = contentEl.createDiv({ cls: "filter-lhs-container" });
    this.createOptionPicker(
      leftInputEl,
      "about-blank-filter-field filter-property-select",
      this.getFieldOptions(condition.field),
      condition.field,
      (value) => {
        const previousOperator = condition.operator;
        condition.field = value;
        const nextFieldType = this.catalog.getFieldType(condition.field);
        const nextOperators = getOperatorsForFieldType(nextFieldType);
        if (!nextOperators.includes(previousOperator)) {
          condition.operator = getDefaultOperatorForFieldType(nextFieldType);
          condition.value = "";
        }
        this.options.onChange();
        this.render();
      },
    );

    const operators = getOperatorsForFieldType(fieldType);
    if (!operators.includes(condition.operator)) {
      operators.push(condition.operator);
    }
    this.createOptionPicker(
      contentEl,
      "about-blank-filter-operator filter-operator",
      operators.map((operator) => ({
        value: operator,
        label: this.getOperatorLabel(operator),
      })),
      condition.operator,
      (value) => {
        condition.operator = value as CustomStatFilterOperator;
        if (isOperatorValueOptional(condition.operator)) {
          condition.value = "";
        }
        this.options.onChange();
        this.render();
      },
    );

    if (!isOperatorValueOptional(condition.operator)) {
      this.renderValueEditor(condition, fieldType, contentEl);
    }

    contentEl.appendChild(actionEl);
    this.createIconButton(
      actionEl,
      "trash",
      "删除条件",
      "about-blank-filter-condition-remove",
      () => {
        this.removeNode(condition.id);
        this.options.onChange();
        this.render();
      },
    );
  }

  private renderValueEditor(
    condition: CustomStatFilterCondition,
    fieldType: CustomStatFieldType,
    parentEl: HTMLElement,
  ): void {
    if (fieldType === "boolean") {
      const valueWrapEl = parentEl.createDiv({
        cls: "filter-rhs-container metadata-property-value about-blank-filter-value-wrap",
      });
      this.createOptionPicker(
        valueWrapEl,
        "about-blank-filter-value",
        [
          { value: "true", label: "真" },
          { value: "false", label: "假" },
        ],
        condition.value === "false" ? "false" : "true",
        (value) => {
          condition.value = value;
          this.options.onChange();
        },
      );
      return;
    }

    const valueWrapEl = parentEl.createDiv({
      cls: "filter-rhs-container metadata-property-value about-blank-filter-value-wrap",
    });
    const valueInput = valueWrapEl.createEl("input", {
      cls: [
        "about-blank-filter-input",
        "about-blank-filter-value",
        fieldType === "number" ? "metadata-input-number" : "metadata-input-text",
        fieldType === "date" ? "mod-date" : "",
      ].filter(Boolean),
      attr: {
        type: fieldType === "date"
          ? "date"
          : fieldType === "number" ? "number" : "text",
        placeholder: fieldType === "multi-select"
          ? "多个值使用逗号分隔"
          : "值",
      },
    });
    valueInput.value = condition.value;
    valueInput.addEventListener("input", () => {
      condition.value = valueInput.value;
      this.options.onChange();
    });
    const suggestions = this.catalog.getValueSuggestions(condition.field);
    if (suggestions.length > 0 && fieldType !== "date" && fieldType !== "number") {
      new ValueSuggester(
        this.app,
        valueInput,
        suggestions,
        fieldType === "multi-select",
      );
    }
  }

  private getFieldOptions(
    currentField: string,
  ): OptionPickerItem[] {
    const fields = this.catalog.getFields();
    const options = fields.map((field): OptionPickerItem => ({
        value: field.name,
        label: field.label,
        keywords: [field.builtIn ? "文件" : "笔记属性"],
        icon: field.icon,
      }));
    if (!fields.some((field) => field.name === currentField)) {
      options.push({
        value: currentField,
        label: currentField || "未知字段",
        keywords: ["笔记属性"],
        icon: "list-tree",
      });
    }
    return options;
  }

  private renderAddActions(
    parentEl: HTMLElement,
    group: CustomStatFilterGroup,
  ): void {
    const actionsEl = parentEl.createDiv({
      cls: "about-blank-filter-add-actions",
    });
    this.createTextActionButton(actionsEl, "plus-circle", "添加条件", () => {
      const condition = createCustomStatFilterCondition();
      group.conditions.push(condition);
      this.options.onChange();
      this.render();
      this.focusConditionField(condition.id);
    });
    this.createTextActionButton(actionsEl, "brackets", "添加条件组", () => {
      group.conditions.push(createCustomStatFilterGroup());
      this.options.onChange();
      this.render();
    });
  }

  private createOptionPicker(
    parentEl: HTMLElement,
    className: string,
    options: OptionPickerItem[],
    currentValue: string,
    onSelect: (value: string) => void,
  ): HTMLButtonElement {
    const picker = new OptionPicker(parentEl, {
      items: options,
      value: currentValue,
      className,
      ariaLabel: "选择选项",
      onSelect,
    });
    this.optionPickers.add(picker);
    return picker.triggerEl;
  }

  private destroyOptionPickers(): void {
    this.optionPickers.forEach((picker) => picker.destroy());
    this.optionPickers.clear();
  }

  private removeNode(targetId: string): void {
    const removeFromGroup = (group: CustomStatFilterGroup): void => {
      group.conditions = group.conditions.filter((node) => {
        if (node.id === targetId) {
          return false;
        }
        if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group) {
          removeFromGroup(node);
          return node.conditions.length > 0;
        }
        return true;
      });
    };
    removeFromGroup(this.root);
  }

  private focusConditionField(conditionId: string): void {
    const containerEl = this.containerEl;
    if (!containerEl) {
      return;
    }
    containerEl.win.requestAnimationFrame(() => {
      const statementEl = Array.from(
        containerEl.querySelectorAll<HTMLElement>(".filter-statement"),
      ).find((element) => element.dataset.conditionId === conditionId);
      statementEl?.querySelector<HTMLButtonElement>(".filter-property-select")
        ?.click();
    });
  }

  private createTextActionButton(
    parentEl: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const buttonEl = parentEl.createEl("button", {
      cls: [
        "clickable-icon",
        "text-icon-button",
        "about-blank-filter-add-action",
      ],
      attr: { type: "button", "aria-label": label },
    });
    const iconEl = buttonEl.createSpan({ cls: "text-button-icon" });
    setIcon(iconEl, icon);
    buttonEl.createSpan({ cls: "text-button-label", text: label });
    buttonEl.addEventListener("click", onClick);
    return buttonEl;
  }

  private createIconButton(
    parentEl: HTMLElement,
    icon: string,
    label: string,
    className: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const buttonEl = parentEl.createEl("button", {
      cls: ["clickable-icon", className],
      attr: { type: "button", "aria-label": label },
    });
    setIcon(buttonEl, icon);
    setTooltip(buttonEl, label);
    buttonEl.addEventListener("click", onClick);
    return buttonEl;
  }

  private getOperatorLabel(operator: CustomStatFilterOperator): string {
    switch (operator) {
      case CUSTOM_STAT_FILTER_OPERATORS.is: return "等于";
      case CUSTOM_STAT_FILTER_OPERATORS.isNot: return "不等于";
      case CUSTOM_STAT_FILTER_OPERATORS.contains: return "包含";
      case CUSTOM_STAT_FILTER_OPERATORS.notContains: return "不包含";
      case CUSTOM_STAT_FILTER_OPERATORS.containsAny: return "包含任意一个";
      case CUSTOM_STAT_FILTER_OPERATORS.containsAll: return "包含全部";
      case CUSTOM_STAT_FILTER_OPERATORS.startsWith: return "开头是";
      case CUSTOM_STAT_FILTER_OPERATORS.endsWith: return "结尾是";
      case CUSTOM_STAT_FILTER_OPERATORS.regexMatch: return "正则匹配";
      case CUSTOM_STAT_FILTER_OPERATORS.lessThan: return "小于";
      case CUSTOM_STAT_FILTER_OPERATORS.lessThanOrEqual: return "小于或等于";
      case CUSTOM_STAT_FILTER_OPERATORS.greaterThan: return "大于";
      case CUSTOM_STAT_FILTER_OPERATORS.greaterThanOrEqual: return "大于或等于";
      case CUSTOM_STAT_FILTER_OPERATORS.before: return "早于";
      case CUSTOM_STAT_FILTER_OPERATORS.onOrBefore: return "早于或等于";
      case CUSTOM_STAT_FILTER_OPERATORS.after: return "晚于";
      case CUSTOM_STAT_FILTER_OPERATORS.onOrAfter: return "晚于或等于";
      case CUSTOM_STAT_FILTER_OPERATORS.exists: return "有值";
      case CUSTOM_STAT_FILTER_OPERATORS.notExists: return "无值";
      default: return operator;
    }
  }
}
