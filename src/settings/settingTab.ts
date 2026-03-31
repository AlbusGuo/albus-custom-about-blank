import {
  type App,
  Notice,
  PluginSettingTab,
  Setting,
  SettingGroup,
  setIcon,
  TFile,
  type TextComponent,
} from "obsidian";

import {
  ACTION_KINDS,
  type Action,
  genNewCmdId,
  newActionClone,
} from "src/settings/action-basic";

import {
  HIDE_DEFAULT_ACTIONS,
} from "src/settings/hideDefault";

import {
  StringSuggesterAsync,
} from "src/ui/stringSuggesterAsync";

import {
  FolderSuggester,
} from "src/ui/folderSuggester";

import {
  ExtensionSuggester,
} from "src/ui/extensionSuggester";

import {
  ActionEditorModal,
} from "src/settings/actionEditorModal";

import {
  countCustomStatFilterConditions,
  CUSTOM_STAT_FILTER_CONDITION_TYPES,
  CUSTOM_STAT_FILTER_CONJUNCTIONS,
  CUSTOM_STAT_FILTER_NODE_KINDS,
  CUSTOM_STAT_FILTER_OPERATORS,
  createCustomStatDefinition,
  createCustomStatFilterCondition,
  createCustomStatFilterGroup,
  getDefaultOperatorForConditionType,
  getOperatorsForConditionType,
  isCustomStatDefinition,
  isOperatorValueOptional,
  type CustomStatDefinition,
  type CustomStatFilterCondition,
  type CustomStatFilterConditionType,
  type CustomStatFilterGroup,
  type CustomStatFilterNode,
  type CustomStatFilterOperator,
} from "src/utils/customStatFilters";

import isBool from "src/utils/isBool";

import {
  loggerOnError,
} from "src/commons";

import type AboutBlank from "src/main";

import {
  type ValuesOf,
} from "src/types";

import {
  type UnsafeApp,
} from "src/unsafe";

import {
  CustomIconManager,
} from "src/utils/customIconManager";

import {
  EditorModal,
} from "src/ui/editorModal";

// =============================================================================

export interface AboutBlankSettings {
  iconTextGap: number;
  hideDefaultActions: ValuesOf<typeof HIDE_DEFAULT_ACTIONS>;
  centerActionListVertically: boolean;
  deleteActionListMarginTop: boolean;
  shortcutListEnabled: boolean;
  shortcutIconFolder: string;
  shortcutIconMask: boolean;
  logoEnabled: boolean;
  logoPath: string;
  logoDirectory: string;
  logoStyle: string;
  logoSize: number;
  logoOpacity: number;
  
  searchBoxEnabled: boolean;
  showStats: boolean;
  showUsageDays: boolean;
  showFileCount: boolean;
  showStorageSize: boolean;
  obsidianStartDate: string;
  heatmapEnabled: boolean;
  heatmapDataSource: string;
  heatmapFrontmatterField: string;
  heatmapColorSegments: Array<{min: number, max: number, color: string}>;
  customStats: CustomStatDefinition[];
  statOrder: string[];
  actions: Action[];
  settingsTab: string;
}

export const DEFAULT_SETTINGS: AboutBlankSettings = {
  iconTextGap: 10,
  hideDefaultActions: HIDE_DEFAULT_ACTIONS.not,
  centerActionListVertically: false,
  deleteActionListMarginTop: false,
  shortcutListEnabled: false,
  shortcutIconFolder: "",
  shortcutIconMask: true,
  logoEnabled: false,
  logoPath: "",
  logoDirectory: "",
  logoStyle: "mask",
  logoSize: 350,
  logoOpacity: 0.4,
  
  searchBoxEnabled: false,
  showStats: false,
  showUsageDays: true,
  showFileCount: true,
  showStorageSize: true,
  obsidianStartDate: "",
  heatmapEnabled: false,
  heatmapDataSource: "frontmatter",
  heatmapFrontmatterField: "created",
  heatmapColorSegments: [
    { min: 0, max: 0, color: "var(--background-primary)" },
    { min: 1, max: 2, color: "#9be9a8" },
    { min: 3, max: 5, color: "#40c463" },
    { min: 6, max: 9, color: "#30a14e" },
    { min: 10, max: 999, color: "#216e39" }
  ],
  customStats: [],
  statOrder: [],
  actions: [],
  settingsTab: "shortcuts",
} as const;

export const DEFAULT_SETTINGS_LIMIT: Partial<
  {
    [key in keyof AboutBlankSettings]: { min: number; max: number; };
  }
> = {
  iconTextGap: {
    min: 0,
    max: 50,
  },
} as const;

// =============================================================================

type HeatmapColorSegment = AboutBlankSettings["heatmapColorSegments"][number];
type CustomStat = AboutBlankSettings["customStats"][number];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isHeatmapColorSegment = (value: unknown): value is HeatmapColorSegment => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.min === "number"
    && typeof value.max === "number"
    && typeof value.color === "string";
};

const isCustomStat = (value: unknown): value is CustomStat => {
  return isCustomStatDefinition(value);
};

interface InlineCustomStatEditorModalOptions {
  title: string;
  onChange: (stat: CustomStatDefinition) => Promise<void>;
  onClose?: () => void;
}

class CustomStatEditorModal {
  private readonly app: App;
  private readonly options: InlineCustomStatEditorModalOptions;
  private draft: CustomStatDefinition;
  private modal: EditorModal | null = null;
  private contentEl: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    initialStat: CustomStatDefinition,
    options: InlineCustomStatEditorModalOptions,
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

    const headerEl = this.contentEl.createDiv({ cls: "about-blank-stat-editor-header" });
    const titleEl = headerEl.createDiv({ cls: "about-blank-stat-editor-title" });
    titleEl.setText(this.draft.displayName.trim() || this.options.title);

    const metaRowEl = this.contentEl.createDiv({ cls: "about-blank-stat-editor-meta-row" });
    const nameControlEl = this.createInlineField(metaRowEl, "名称");

    const nameInput = nameControlEl.createEl("input", {
      cls: "about-blank-stat-editor-input about-blank-stat-editor-name-input",
      attr: { type: "text", placeholder: "显示名称" },
    });
    nameInput.value = this.draft.displayName;
    nameInput.addEventListener("input", () => {
      this.draft.displayName = nameInput.value;
      titleEl.setText(this.draft.displayName.trim() || this.options.title);
    });
    nameInput.addEventListener("change", () => {
      void this.commitChanges();
    });

    const conjunctionControlEl = this.createInlineField(metaRowEl, "根组");
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
        if (parentGroup.conditions.length <= 1) {
          return;
        }
        parentGroup.conditions = parentGroup.conditions.filter((node) => node.id !== group.id);
        this.renderBody();
        void this.commitChanges();
      });
      removeGroupButton.addClass("is-danger");
      removeGroupButton.toggleClass("is-disabled", parentGroup.conditions.length <= 1);
      removeGroupButton.disabled = parentGroup.conditions.length <= 1;
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
      if (group.conditions.length <= 1) {
        return;
      }
      group.conditions = group.conditions.filter((node) => node.id !== condition.id);
      this.renderBody();
      void this.commitChanges();
    });
    removeButton.addClass("is-danger");
    removeButton.toggleClass("is-disabled", group.conditions.length <= 1);
    removeButton.disabled = group.conditions.length <= 1;
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
      [CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter, "Frontmatter"],
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

// =============================================================================

export const settingsPropTypeCheck: {
  [key in keyof AboutBlankSettings]: (value: unknown) => boolean;
} = {
  iconTextGap: (value: unknown) => {
    if (!Number.isFinite(value)) {
      return false;
    }
    const num = value as number;
    const limit = DEFAULT_SETTINGS_LIMIT.iconTextGap;
    if (!limit) {
      return false;
    }
    return limit.min <= num && num <= limit.max;
  },
  hideDefaultActions: (value: unknown) => {
    const correctValues: unknown[] = Object.values(HIDE_DEFAULT_ACTIONS);
    return correctValues.includes(value);
  },
  centerActionListVertically: (value: unknown) => isBool(value),
  deleteActionListMarginTop: (value: unknown) => isBool(value),
  shortcutListEnabled: (value: unknown) => isBool(value),
  shortcutIconFolder: (value: unknown) => typeof value === "string",
  shortcutIconMask: (value: unknown) => isBool(value),
  logoEnabled: (value: unknown) => isBool(value),
  logoPath: (value: unknown) => typeof value === "string",
  logoDirectory: (value: unknown) => typeof value === "string",
  logoStyle: (value: unknown) => {
    return typeof value === "string" && ["mask", "original"].includes(value);
  },
  logoSize: (value: unknown) => typeof value === "number" && Number.isFinite(value),
  logoOpacity: (value: unknown) => typeof value === "number" && Number.isFinite(value),
  heatmapEnabled: (value: unknown) => isBool(value),
  heatmapDataSource: (value: unknown) => {
    return typeof value === "string" && ["frontmatter", "fileCreation"].includes(value);
  },
  heatmapFrontmatterField: (value: unknown) => typeof value === "string",
  heatmapColorSegments: (value: unknown) => {
    return Array.isArray(value) && value.every(isHeatmapColorSegment);
  },
  customStats: (value: unknown) => {
    return Array.isArray(value) && value.every(isCustomStat);
  },
  statOrder: (value: unknown) => {
    return Array.isArray(value) && value.every(item => typeof item === "string");
  },
  searchBoxEnabled: (value: unknown) => isBool(value),
  showStats: (value: unknown) => isBool(value),
  showUsageDays: (value: unknown) => isBool(value),
  showFileCount: (value: unknown) => isBool(value),
  showStorageSize: (value: unknown) => isBool(value),
  obsidianStartDate: (value: unknown) => typeof value === "string",
  actions: (value: unknown) => Array.isArray(value),
  settingsTab: (value: unknown) => typeof value === "string",
};

// =============================================================================

export const defaultSettingsClone = (): AboutBlankSettings => {
  return structuredClone(DEFAULT_SETTINGS);
};

// =============================================================================

export class AboutBlankSettingTab extends PluginSettingTab {
  plugin: AboutBlank;
  icon: string = 'app-window';
  newActionName: string = "";
  private draggedIndex: number | null = null;
  private customStatEditorModal: CustomStatEditorModal | null = null;
  private customStatEditorIndex: number | null = null;
  private customStatEditorRefreshPending = false;
  private customStatRowElements = new Map<number, HTMLElement>();
  private actionEditorModal: ActionEditorModal | null = null;
  private actionEditorIndex: number | null = null;
  private actionEditorRefreshPending = false;
  private actionRowElements = new Map<number, HTMLElement>();
  private readonly customIconManager: CustomIconManager;

  constructor(app: App, plugin: AboutBlank) {
    super(app, plugin);
    this.plugin = plugin;
    this.customIconManager = CustomIconManager.getInstance(app);
  }

  // ---------------------------------------------------------------------------

  display = (): void => {
    try {
      this.containerEl.empty();
      this.containerEl.addClass('about-blank-setting-ui');

      // 创建标签页导航
      const tabNames = ["shortcuts", "logo", "stats", "heatmap"];
      const tabLabels: Record<string, string> = {
        shortcuts: "快捷方式",
        logo: "Logo",
        stats: "统计项目",
        heatmap: "热力图"
      };

      const tabsEl = this.containerEl.createDiv({ cls: "about-blank-settings-tabs" });
      for (const tabName of tabNames) {
        const tab = tabsEl.createDiv({
          cls: "about-blank-settings-tab"
            + (this.plugin.settings.settingsTab === tabName ? " is-active" : "")
        });
        tab.setText(tabLabels[tabName]);
        tab.addEventListener("click", () => {
          void (async () => {
            this.plugin.settings.settingsTab = tabName;
            await this.plugin.saveSettings();
            this.display();
          })();
        });
      }

      // 创建内容区域容器
      this.containerEl.createDiv({ cls: "about-blank-settings-content" });
      this.renderCurrentTab();
    } catch (error) {
      loggerOnError(error, "Error in settings.\n(About Blank)");
    }
  };

  /**
   * 渲染当前选择的标签页内容
   */
  renderCurrentTab = (): void => {
    const contentEl = this.containerEl.querySelector('.about-blank-settings-content');
    if (!contentEl) return;

    const activeActionIndex = this.plugin.settings.settingsTab === "shortcuts"
      ? this.actionEditorIndex
      : null;
    const activeCustomStatIndex = this.plugin.settings.settingsTab === "stats"
      ? this.customStatEditorIndex
      : null;
    this.closeActionEditor(false);
    this.closeCustomStatEditor(false);
    contentEl.empty();
    this.actionRowElements.clear();
    this.customStatRowElements.clear();

    if (this.plugin.settings.settingsTab === "shortcuts") {
      this.makeSettingsShortcuts(contentEl as HTMLElement);
      if (activeActionIndex !== null && activeActionIndex < this.plugin.settings.actions.length) {
        this.actionEditorIndex = activeActionIndex;
        requestAnimationFrame(() => {
          this.reopenActionEditor();
        });
      }
    } else if (this.plugin.settings.settingsTab === "logo") {
      this.actionEditorIndex = null;
      this.makeSettingsLogo(contentEl as HTMLElement);
    } else if (this.plugin.settings.settingsTab === "stats") {
      this.actionEditorIndex = null;
      this.makeSettingsStats(contentEl as HTMLElement);
      if (activeCustomStatIndex !== null && activeCustomStatIndex < this.plugin.settings.customStats.length) {
        this.customStatEditorIndex = activeCustomStatIndex;
        requestAnimationFrame(() => {
          this.reopenCustomStatEditor();
        });
      }
    } else if (this.plugin.settings.settingsTab === "heatmap") {
      this.actionEditorIndex = null;
      this.customStatEditorIndex = null;
      this.makeSettingsHeatmap(contentEl as HTMLElement);
    } else {
      this.actionEditorIndex = null;
      this.customStatEditorIndex = null;
    }
  };

  private makeSettingsShortcuts = (containerEl: HTMLElement): void => {
    const basicGroup = new SettingGroup(containerEl);

    basicGroup.addSetting((shortcutListSetting) => {
      shortcutListSetting
        .setName("启用快捷方式列表")
        .setDesc("控制是否在新标签页显示快捷方式列表")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.shortcutListEnabled)
            .onChange(async (value) => {
              try {
                this.plugin.settings.shortcutListEnabled = value;
                await this.plugin.saveSettings();
                this.plugin.refreshAllNewTabs();
                this.renderCurrentTab();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    });

    if (this.plugin.settings.shortcutListEnabled) {
      basicGroup.addSetting((iconFolderSetting) => {
        iconFolderSetting
          .setName("自定义图标文件夹")
          .setDesc("限制快捷方式图标选择器只显示指定文件夹下的 SVG 图标")
          .addText((text) => {
            text
              .setPlaceholder("例如 attachments/icons")
              .setValue(this.plugin.settings.shortcutIconFolder)
              .onChange((value) => {
                this.plugin.settings.shortcutIconFolder = value.trim();
              });

            new FolderSuggester(this.app, text.inputEl);
            text.inputEl.addEventListener("blur", () => {
              void (async () => {
                this.plugin.customIconManager.clearCache();
                await this.plugin.saveSettings();
                this.renderCurrentTab();
              })();
            });
          });
      });

      basicGroup.addSetting((iconMaskSetting) => {
        iconMaskSetting
          .setName("自定义图标遮罩")
          .setDesc("开启后将自定义 SVG 图标统一渲染为 Obsidian 图标颜色")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.shortcutIconMask)
              .onChange(async (value) => {
                this.plugin.settings.shortcutIconMask = value;
                await this.plugin.saveSettings();
                this.plugin.refreshAllNewTabs();
                this.renderCurrentTab();
              });
          });
      });

      basicGroup.addSetting((hideDefaultSetting) => {
        hideDefaultSetting
          .setName("隐藏默认快捷方式")
          .setDesc("开启时隐藏默认快捷方式, 关闭时显示默认快捷方式")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.hideDefaultActions !== HIDE_DEFAULT_ACTIONS.not)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.hideDefaultActions = value
                    ? HIDE_DEFAULT_ACTIONS.all
                    : HIDE_DEFAULT_ACTIONS.not;
                  await this.plugin.saveSettings();
                  this.plugin.refreshAllNewTabs();
                  this.renderCurrentTab();
                } catch (error) {
                  loggerOnError(error, "Error in settings.\n(About Blank)");
                }
              });
          });
      });
    }

    // 搜索框开关
    basicGroup.addSetting((searchBoxSetting) => {
      searchBoxSetting
        .setName("搜索框")
        .setDesc("在新标签页中嵌入 Obsidian 内置搜索框")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.searchBoxEnabled)
            .onChange(async (value) => {
              try {
                this.plugin.settings.searchBoxEnabled = value;
                await this.plugin.saveSettings();
                this.plugin.refreshAllNewTabs();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    });

    if (this.plugin.settings.shortcutListEnabled) {
      new Setting(containerEl)
        .setName("快捷方式列表")
        .setHeading();

      const actionsGroup = new SettingGroup(containerEl);

      if (this.plugin.settings.actions.length === 0) {
        actionsGroup.addSetting((emptySetting) => {
          emptySetting.settingEl.addClass('about-blank-action-empty-setting');
          const emptyStateEl = emptySetting.infoEl.createDiv({ cls: 'about-blank-action-empty' });
          emptyStateEl.createEl('p', { text: '还没有添加任何快捷方式' });
          emptyStateEl.createEl('p', {
            text: '点击下方按钮开始创建快捷方式',
            cls: 'setting-item-description',
          });
        });
      } else {
        this.plugin.settings.actions.forEach((action, index) => {
          this.createActionSetting(actionsGroup, action, index);
        });
      }

      actionsGroup.addSetting((addSetting) => {
        addSetting.settingEl.addClass('about-blank-item-add-setting');
        addSetting.controlEl.addClass('about-blank-item-add-container');
        addSetting.addButton((button) => {
          button
            .setButtonText('添加新快捷方式')
            .setClass('about-blank-item-add-btn')
            .onClick(async () => {
              const newAction = newActionClone();
              newAction.name = '新快捷方式';
              newAction.cmdId = genNewCmdId(this.plugin.settings);
              this.plugin.settings.actions.push(newAction);
              this.actionEditorIndex = this.plugin.settings.actions.length - 1;
              await this.plugin.saveSettings();
              this.renderCurrentTab();
            });
        });
      });
    }
  };

  private makeSettingsLogo = (containerEl: HTMLElement): void => {
    const logoGroup = new SettingGroup(containerEl);

    logoGroup.addSetting((logoEnabledSetting) => {
      logoEnabledSetting
        .setName("启用 Logo")
        .setDesc("在新标签页显示自定义 Logo 图片")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.logoEnabled)
            .onChange(async (value) => {
              try {
                this.plugin.settings.logoEnabled = value;
                await this.plugin.saveSettings();
                this.plugin.refreshAllNewTabs();
                this.renderCurrentTab();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });
    });

      if (this.plugin.settings.logoEnabled) {
        // 添加Logo文件目录设置（放在Logo图片路径上方）
        logoGroup.addSetting((logoDirectorySetting) => {
          let logoDirectoryInput: TextComponent;
          logoDirectorySetting
            .setName("Logo 文件目录")
            .setDesc("限制只显示指定文件夹下的图片, 可直接输入路径或从联想列表选择")
            .addText((text) => {
              logoDirectoryInput = text;
              text
                .setPlaceholder("例如 attachments/logo")
                .setValue(this.plugin.settings.logoDirectory)
                .onChange((value) => {
                  try {
                    this.plugin.settings.logoDirectory = value;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });

              new FolderSuggester(this.app, text.inputEl);
                
              logoDirectoryInput.inputEl.addEventListener('blur', () => {
                void (async () => {
                  try {
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllNewTabs();
                    this.renderCurrentTab();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                })();
              });
            });
        });

        logoGroup.addSetting((logoPathSetting) => {
          let logoTextInput: TextComponent;
          logoPathSetting
            .setName("Logo 图片路径")
            .setDesc("选择库内图片文件作为 Logo")
            .addText((text) => {
              logoTextInput = text;
              text
                .setPlaceholder("遮罩样式推荐使用透明背景的图片, 只保留形状")
                .setValue(this.plugin.settings.logoPath)
                .onChange((value) => {
                  try {
                    this.plugin.settings.logoPath = value;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
                
              logoTextInput.inputEl.addEventListener('blur', () => {
                void (async () => {
                  try {
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllNewTabs();
                    this.renderCurrentTab();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                })();
              });
            })
            .addButton((button) => {
              button
                .setButtonText("选择文件")
                .onClick(async () => {
                  try {
                    const selectedPath = await this.plugin.showFileSelectionDialog();
                    
                    if (selectedPath) {
                      logoTextInput.setValue(selectedPath);
                      this.plugin.settings.logoPath = selectedPath;
                      await this.plugin.saveSettings();
                      this.plugin.refreshAllNewTabs();
                      this.renderCurrentTab();
                      new Notice(`已选择图片: ${selectedPath}`, 3000);
                    }
                  } catch (error) {
                    loggerOnError(error, "文件选择失败\n(About Blank)");
                    new Notice("文件选择失败, 请手动输入图片的相对路径", 5000);
                  }
                });
            });
        });

        logoGroup.addSetting((logoStyleSetting) => {
          logoStyleSetting
            .setName("Logo 样式")
            .setDesc("选择 Logo 的显示样式")
            .addDropdown((dropdown) => {
              dropdown
                .addOption("mask", "遮罩样式")
                .addOption("original", "原图样式")
                .setValue(this.plugin.settings.logoStyle)
                .onChange(async (value: "mask" | "original") => {
                  try {
                    this.plugin.settings.logoStyle = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllNewTabs();
                    this.renderCurrentTab();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
            });
        });

        logoGroup.addSetting((logoOpacitySetting) => {
          let logoOpacityInput: TextComponent;
          logoOpacitySetting
            .setName("Logo 透明度")
            .setDesc("设置Logo的透明度 (范围: 0-1)")
            .addText((text) => {
              logoOpacityInput = text;
              text
                .setPlaceholder(`例如: ${DEFAULT_SETTINGS.logoOpacity}`)
                .setValue(this.plugin.settings.logoOpacity.toString())
                .onChange((value) => {
                  try {
                    const num = parseFloat(value);
                    if (!settingsPropTypeCheck.logoOpacity(num)) {
                      return;
                    }
                    this.plugin.settings.logoOpacity = num;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
                
              logoOpacityInput.inputEl.addEventListener('blur', () => {
                void (async () => {
                  try {
                    const num = parseFloat(logoOpacityInput.getValue());
                    if (!settingsPropTypeCheck.logoOpacity(num)) {
                      logoOpacityInput.setValue(this.plugin.settings.logoOpacity.toString());
                      return;
                    }
                    this.plugin.settings.logoOpacity = num;
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllNewTabs();
                    this.renderCurrentTab();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                })();
              });
            });
        });

      }
  };

  private makeSettingsStats = (containerEl: HTMLElement): void => {
    const statsGroup = new SettingGroup(containerEl);

    // 统计项目开关
    statsGroup.addSetting((showStatsSetting) => {
      showStatsSetting
        .setName("显示统计项目")
        .setDesc("在新标签页显示文件统计信息")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.showStats)
            .onChange(async (value) => {
              try {
                this.plugin.settings.showStats = value;
                await this.plugin.saveSettings();
                this.renderCurrentTab();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });
    });

    if (this.plugin.settings.showStats) {
      // 内置统计项标题
      new Setting(containerEl)
        .setName("内置统计项目")
        .setHeading();

      const builtinGroup = new SettingGroup(containerEl);

      builtinGroup.addSetting((usageDaysSetting) => {
        usageDaysSetting
          .setName("Obsidian 使用天数")
          .setDesc("显示使用 Obsidian 的天数")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showUsageDays)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.showUsageDays = value;
                  await this.plugin.saveSettings();
                  this.plugin.refreshAllNewTabs();
                  this.renderCurrentTab();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      });

      if (this.plugin.settings.showUsageDays) {
        // Obsidian 开始使用日期
        builtinGroup.addSetting((startDateSetting) => {
          let obsidianStartDateInput: TextComponent;
          startDateSetting
            .setName("开始使用 Obsidian 的日期")
            .setDesc("用于计算使用 Obsidian 的天数")
            .addText((text) => {
              obsidianStartDateInput = text;
              text.inputEl.type = 'date';
              text
                .setValue(this.plugin.settings.obsidianStartDate)
                .onChange((value) => {
                  try {
                    this.plugin.settings.obsidianStartDate = value;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
                
              obsidianStartDateInput.inputEl.addEventListener('blur', () => {
                void this.plugin.saveSettings().catch((error) => {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                });
              });
            });
        });
      }

      builtinGroup.addSetting((fileCountSetting) => {
        fileCountSetting
          .setName("文件数量")
          .setDesc("显示仓库中的文件总数")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showFileCount)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.showFileCount = value;
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      });

      builtinGroup.addSetting((storageSizeSetting) => {
        storageSizeSetting
          .setName("存储空间")
          .setDesc("显示仓库的总存储大小")
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.showStorageSize)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.showStorageSize = value;
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      });

      // 自定义统计项目标题
      new Setting(containerEl)
        .setName("自定义统计项目")
        .setHeading();

      const customStatsGroup = new SettingGroup(containerEl);

      if (this.plugin.settings.customStats.length === 0) {
        customStatsGroup.addSetting((emptySetting) => {
          emptySetting
            .setName('还没有添加任何自定义统计项目')
            .setDesc('点击下方按钮开始创建');
        });
      } else {
        this.plugin.settings.customStats.forEach((stat, index) => {
          customStatsGroup.addSetting((statHeaderSetting) => {
            statHeaderSetting
              .setName(stat.displayName.trim() || `统计项目 ${index + 1}`)
              .setDesc(this.getCustomStatSummary(stat));
            statHeaderSetting.settingEl.addClass('about-blank-stat-setting');
            this.customStatRowElements.set(index, statHeaderSetting.settingEl);

            statHeaderSetting.addExtraButton((button) => {
              button
                .setIcon("pencil")
                .setTooltip("编辑")
                .onClick(() => {
                  this.openCustomStatEditor(index);
                });
            });

            statHeaderSetting.addExtraButton((button) => {
              button.setIcon("trash")
                .setTooltip("删除")
                .onClick(async () => {
                  const previousEditorIndex = this.customStatEditorIndex;
                  this.plugin.settings.customStats.splice(index, 1);
                  if (previousEditorIndex === index) {
                    this.customStatEditorIndex = null;
                  } else if (previousEditorIndex !== null && previousEditorIndex > index) {
                    this.customStatEditorIndex = previousEditorIndex - 1;
                  }
                  await this.plugin.saveSettings();
                  this.plugin.refreshAllNewTabs();
                  this.renderCurrentTab();
                });
            });

          });
        });
      }

      customStatsGroup.addSetting((addSetting) => {
        addSetting.settingEl.addClass('about-blank-item-add-setting');
        addSetting.controlEl.addClass('about-blank-item-add-container');
        addSetting.addButton((button) => {
          button
            .setButtonText('添加新统计项目')
            .setClass('about-blank-item-add-btn')
            .onClick(async () => {
              this.plugin.settings.customStats.push(createCustomStatDefinition());
              this.customStatEditorIndex = this.plugin.settings.customStats.length - 1;
              await this.plugin.saveSettings();
              this.plugin.refreshAllNewTabs();
              this.renderCurrentTab();
            });
        });
      });
    }
  };

  private getCustomStatSummary = (stat: CustomStat): string => {
    const conjunctionText = stat.filters.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.and
      ? "根组: 全部满足"
      : "根组: 任一满足";
    const previewText = this.getCustomStatPreview(stat.filters)
      .filter(Boolean)
      .join(" · ");
    const countText = `${countCustomStatFilterConditions(stat.filters)} 条条件`;
    return [conjunctionText, countText, previewText].filter(Boolean).join(" · ");
  };

  private getCustomStatPreview = (group: CustomStatFilterGroup): string[] => {
    return group.conditions
      .slice(0, 2)
      .map((node) => this.getCustomStatNodeSummary(node))
      .filter(Boolean);
  };

  private getCustomStatNodeSummary = (node: CustomStatFilterNode): string => {
    if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.condition) {
      return this.getCustomStatConditionSummary(node);
    }

    const preview = this.getCustomStatPreview(node).join(" · ");
    const prefix = node.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.and ? "组(全部)" : "组(任一)";
    return preview ? `${prefix}: ${preview}` : prefix;
  };

  private getCustomStatConditionLabel = (type: CustomStatFilterConditionType): string => {
    switch (type) {
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.folder:
        return "文件夹";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType:
        return "文件类型";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName:
        return "文件名";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.tag:
        return "标签";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt:
        return "创建日期";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt:
        return "修改日期";
      case CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter:
        return "Frontmatter";
      default:
        return type;
    }
  };

  private getCustomStatConditionSummary = (condition: CustomStatFilterCondition): string => {
    const typeLabel = condition.type === CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter
      ? `Frontmatter.${condition.key || "字段"}`
      : this.getCustomStatConditionLabel(condition.type);
    const operatorLabel = this.getCustomStatOperatorLabel(condition.operator);
    if (isOperatorValueOptional(condition.operator)) {
      return `${typeLabel} ${operatorLabel}`;
    }
    return `${typeLabel} ${operatorLabel} ${condition.value || "未设置"}`;
  };

  private openCustomStatEditor = (index: number): void => {
    const stat = this.plugin.settings.customStats[index];
    const anchorEl = this.customStatRowElements.get(index);
    if (!stat || !anchorEl) {
      return;
    }

    if (this.customStatEditorIndex === index && this.customStatEditorModal) {
      this.closeCustomStatEditor();
      return;
    }

    this.closeCustomStatEditor(false);
    this.customStatEditorIndex = index;
    this.customStatEditorModal = new CustomStatEditorModal(this.app, stat, {
      title: stat.displayName.trim() || `统计项目 ${index + 1}`,
      onChange: async (nextStat: CustomStatDefinition) => {
        if (!this.plugin.settings.customStats[index]) {
          return;
        }
        this.plugin.settings.customStats[index] = nextStat;
        this.customStatEditorRefreshPending = true;
        await this.plugin.saveSettingsSilent();
        this.updateCustomStatRow(index);
      },
      onClose: () => {
        this.customStatEditorModal = null;
        this.customStatEditorIndex = null;
        this.flushCustomStatEditorRefresh();
      },
    });
    this.customStatEditorModal.open();
  };

  private reopenCustomStatEditor = (): void => {
    if (this.customStatEditorIndex === null) {
      return;
    }
    if (!this.customStatRowElements.has(this.customStatEditorIndex)) {
      this.customStatEditorIndex = null;
      return;
    }
    this.openCustomStatEditor(this.customStatEditorIndex);
  };

  private closeCustomStatEditor = (clearIndex: boolean = true): void => {
    const modal = this.customStatEditorModal;
    this.customStatEditorModal = null;
    if (clearIndex) {
      this.customStatEditorIndex = null;
    }
    modal?.close();
  };

  private flushCustomStatEditorRefresh = (): void => {
    if (!this.customStatEditorRefreshPending) {
      return;
    }
    this.customStatEditorRefreshPending = false;
    this.plugin.refreshAllNewTabs();
  };

  private updateCustomStatRow = (index: number): void => {
    const rowEl = this.customStatRowElements.get(index);
    const stat = this.plugin.settings.customStats[index];
    if (!rowEl || !stat) {
      return;
    }

    const nameEl = rowEl.querySelector('.setting-item-name');
    if (nameEl) {
      nameEl.setText(stat.displayName.trim() || `统计项目 ${index + 1}`);
    }

    const summary = this.getCustomStatSummary(stat);
    const descEl = rowEl.querySelector('.setting-item-description');
    if (summary) {
      if (descEl instanceof HTMLElement) {
        descEl.setText(summary);
      } else {
        rowEl.querySelector('.setting-item-info')?.createDiv({
          cls: 'setting-item-description',
          text: summary,
        });
      }
      return;
    }

    descEl?.remove();
  };

  private getCustomStatOperatorLabel = (operator: CustomStatFilterOperator): string => {
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

  /**
   * 创建单个按钮的设置项（使用 SettingGroup API）
   */
  private createActionSetting = (actionsGroup: SettingGroup, action: Action, index: number): void => {
    actionsGroup.addSetting((setting) => {
      setting.settingEl.addClass('about-blank-action-setting');
      setting.settingEl.dataset.index = index.toString();
      setting.setName(action.name.trim() || `快捷方式 ${index + 1}`);
      setting.setDesc(this.getActionSummary(action));
      this.actionRowElements.set(index, setting.settingEl);
      this.decorateActionName(setting, action);

      this.makeDraggable(setting.settingEl, index);

      setting.addExtraButton((button) => button
        .setIcon('pencil')
        .setTooltip('编辑快捷方式')
        .onClick(() => {
          this.openActionEditor(index);
        }));

      setting.addExtraButton((button) => button
        .setIcon('trash')
        .setTooltip('删除快捷方式')
        .onClick(async () => {
          const previousEditorIndex = this.actionEditorIndex;
          this.plugin.settings.actions.splice(index, 1);
          if (previousEditorIndex === index) {
            this.actionEditorIndex = null;
          } else if (previousEditorIndex !== null && previousEditorIndex > index) {
            this.actionEditorIndex = previousEditorIndex - 1;
          }
          await this.plugin.saveSettings();
          this.plugin.refreshAllNewTabs();
          this.renderCurrentTab();
        }));

      this.addDragHandle(setting, index);
    });
  };

  private decorateActionName(setting: Setting, action: Action): void {
    setting.nameEl.empty();

    const nameWrapEl = setting.nameEl.createSpan({ cls: 'about-blank-action-name-wrap' });
    const iconWrapEl = nameWrapEl.createSpan({ cls: 'about-blank-action-name-icon' });
    const previewEl = iconWrapEl.createSpan({ cls: 'about-blank-icon-picker-preview about-blank-icon-picker-preview-compact' });
    nameWrapEl.createSpan({
      cls: 'about-blank-action-name-text',
      text: action.name.trim() || '未命名快捷方式',
    });

    const renderPreview = async () => {
      previewEl.empty();
      if (!action.icon) {
        setIcon(previewEl, 'slash');
        return;
      }

      if (this.customIconManager.isCustomIcon(action.icon)) {
        const rendered = await this.customIconManager.renderIcon(action.icon, previewEl, this.plugin.settings.shortcutIconMask);
        if (!rendered) {
          previewEl.setText('?');
        }
        return;
      }

      try {
        setIcon(previewEl, action.icon);
      } catch {
        previewEl.setText('?');
      }
    };

    void renderPreview();
  }

  private getActionSummary(action: Action): string {
    const target = action.content.kind === ACTION_KINDS.command
      ? action.content.commandName || action.content.commandId || '未设置命令'
      : action.content.filePath || '未设置文件';
    return `${action.content.kind === ACTION_KINDS.command ? '命令' : '文件'} · ${target}`;
  }

  private openActionEditor(index: number): void {
    const action = this.plugin.settings.actions[index];
    const anchorEl = this.actionRowElements.get(index);
    if (!action || !anchorEl) {
      return;
    }

    if (this.actionEditorIndex === index && this.actionEditorModal) {
      this.closeActionEditor();
      return;
    }

    this.closeActionEditor(false);
    this.actionEditorIndex = index;
    this.actionEditorModal = new ActionEditorModal(this.app, action, {
      title: action.name.trim() || `快捷方式 ${index + 1}`,
      iconFolder: this.plugin.settings.shortcutIconFolder,
      iconMask: this.plugin.settings.shortcutIconMask,
      onChange: async (nextAction) => {
        if (!this.plugin.settings.actions[index]) {
          return;
        }
        this.plugin.settings.actions[index] = nextAction;
        this.actionEditorRefreshPending = true;
        await this.plugin.saveSettingsSilent();
        this.updateActionRow(index);
      },
      onClose: () => {
        this.actionEditorModal = null;
        this.actionEditorIndex = null;
        this.flushActionEditorRefresh();
      },
    });
    this.actionEditorModal.open();
  }

  private reopenActionEditor(): void {
    if (this.actionEditorIndex === null) {
      return;
    }
    if (!this.actionRowElements.has(this.actionEditorIndex)) {
      this.actionEditorIndex = null;
      return;
    }
    this.openActionEditor(this.actionEditorIndex);
  }

  private closeActionEditor(clearIndex: boolean = true): void {
    const modal = this.actionEditorModal;
    this.actionEditorModal = null;
    if (clearIndex) {
      this.actionEditorIndex = null;
    }
    modal?.close();
  }

  private flushActionEditorRefresh(): void {
    if (!this.actionEditorRefreshPending) {
      return;
    }
    this.actionEditorRefreshPending = false;
    this.plugin.refreshAllNewTabs();
  }

  private updateActionRow(index: number): void {
    const rowEl = this.actionRowElements.get(index);
    const action = this.plugin.settings.actions[index];
    if (!rowEl || !action) {
      return;
    }

    const nameEl = rowEl.querySelector('.setting-item-name');
    if (nameEl instanceof HTMLElement) {
      nameEl.empty();
      const setting = { nameEl, settingEl: rowEl } as Setting;
      this.decorateActionName(setting, action);
    }

    const summary = this.getActionSummary(action);
    const descEl = rowEl.querySelector('.setting-item-description');
    if (descEl instanceof HTMLElement) {
      descEl.setText(summary);
    }
  }

  /**
   * 添加拖拽手柄
   */
  private addDragHandle = (setting: Setting, index: number): void => {
    const dragHandle = setting.controlEl.createDiv({
      cls: 'about-blank-drag-handle',
      attr: { 'aria-label': '拖拽排序' }
    });
    setIcon(dragHandle, 'grip-vertical');
    
    dragHandle.addEventListener('mousedown', () => {
      setting.settingEl.setAttribute('draggable', 'true');
    });
    
    dragHandle.addEventListener('mouseup', () => {
      setting.settingEl.setAttribute('draggable', 'false');
    });
  };

  /**
   * 使设置项可拖拽（参考 Custom Ribbon Buttons）
   */
  private makeDraggable = (element: HTMLElement, index: number): void => {
    element.setAttribute('draggable', 'false');
    element.classList.add('about-blank-draggable-setting');
    element.dataset.index = index.toString();

    element.addEventListener('dragstart', (e) => {
      this.draggedIndex = index;
      element.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
      }
    });

    element.addEventListener('dragend', () => {
      this.draggedIndex = null;
      element.classList.remove('dragging');
      document.querySelectorAll('.about-blank-draggable-setting.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });
    });

    element.addEventListener('dragover', (e) => {
      if (this.draggedIndex !== null && this.draggedIndex !== index) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        element.classList.add('drag-over');
      }
    });

    element.addEventListener('dragenter', (e) => {
      if (this.draggedIndex !== null && this.draggedIndex !== index) {
        e.preventDefault();
        element.classList.add('drag-over');
      }
    });

    element.addEventListener('dragleave', (e) => {
      if (e.currentTarget === e.target || !element.contains(e.relatedTarget as Node)) {
        element.classList.remove('drag-over');
      }
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      element.classList.remove('drag-over');

      if (this.draggedIndex !== null && this.draggedIndex !== index) {
        void this.reorderActions(this.draggedIndex, index);
      }
    });
  };

  /**
   * 重新排序按钮
   */
  private reorderActions = async (fromIndex: number, toIndex: number): Promise<void> => {
    const actions = this.plugin.settings.actions;
    const [movedAction] = actions.splice(fromIndex, 1);
    actions.splice(toIndex, 0, movedAction);
    await this.plugin.saveSettings();
    // 刷新所有打开的新标签页，使其显示最新的按钮顺序
    this.plugin.refreshAllNewTabs();
    this.renderCurrentTab();
  };

  private makeSettingsHeatmap = (containerEl: HTMLElement): void => {
    const heatmapGroup = new SettingGroup(containerEl);

    // 热力图设置
    heatmapGroup.addSetting((heatmapEnabledSetting) => {
      heatmapEnabledSetting
        .setName("启用热力图")
        .setDesc("在新标签页显示文件数量热力图")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.heatmapEnabled)
            .onChange(async (value) => {
              try {
                this.plugin.settings.heatmapEnabled = value;
                await this.plugin.saveSettings();
                this.renderCurrentTab();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });
    });

    if (this.plugin.settings.heatmapEnabled) {
      heatmapGroup.addSetting((dataSourceSetting) => {
        dataSourceSetting
          .setName("数据来源")
          .setDesc("选择统计文件日期的数据来源")
          .addDropdown((dropdown) => {
            dropdown
              .addOption("frontmatter", "Frontmatter 字段")
              .addOption("fileCreation", "文件创建时间")
              .setValue(this.plugin.settings.heatmapDataSource)
              .onChange(async (value: "frontmatter" | "fileCreation") => {
                try {
                  this.plugin.settings.heatmapDataSource = value;
                  await this.plugin.saveSettings();
                  this.renderCurrentTab();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      });

      if (this.plugin.settings.heatmapDataSource === "frontmatter") {
        heatmapGroup.addSetting((frontmatterFieldSetting) => {
          frontmatterFieldSetting
            .setName("Frontmatter 字段名")
            .setDesc("设置用于统计日期的 Frontmatter 字段名称")
            .addText((text) => {
              text
                .setPlaceholder("例如: created")
                .setValue(this.plugin.settings.heatmapFrontmatterField)
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.heatmapFrontmatterField = value;
                    await this.plugin.saveSettings();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
            });
        });
      }

      // 颜色分段设置（跳过零值分段）
      for (let i = 1; i < this.plugin.settings.heatmapColorSegments.length; i++) {
        const segment = this.plugin.settings.heatmapColorSegments[i];
        heatmapGroup.addSetting((segmentSetting) => {
          segmentSetting.setName(`分段 ${i}`);

          segmentSetting.addText((text) => {
            text.setPlaceholder("最小值")
              .setValue(segment.min.toString())
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].min = parseInt(value) || 0;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass('about-blank-input-narrow');
          });

          segmentSetting.addText((text) => {
            text.setPlaceholder("最大值")
              .setValue(segment.max.toString())
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].max = parseInt(value) || 0;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass('about-blank-input-narrow');
          });

          segmentSetting.addColorPicker((colorPicker) => {
            colorPicker
              .setValue(segment.color.startsWith('#') ? segment.color : '#40c463')
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].color = value;
                await this.plugin.saveSettings();
              });
          });

          // 删除按钮（至少保留一个分段）
          if (this.plugin.settings.heatmapColorSegments.length > 2) {
            segmentSetting.addExtraButton((button) => {
              button.setIcon("trash")
                .setTooltip("删除")
                .onClick(async () => {
                  this.plugin.settings.heatmapColorSegments.splice(i, 1);
                  await this.plugin.saveSettings();
                  this.renderCurrentTab();
                });
            });
          }
        });
      }

      // 添加新分段按钮
      heatmapGroup.addSetting((addSegmentSetting) => {
        addSegmentSetting.addButton((button) => {
          button
            .setButtonText("+ 添加颜色分段")
            .setCta()
            .onClick(async () => {
              const lastSegment = this.plugin.settings.heatmapColorSegments[this.plugin.settings.heatmapColorSegments.length - 1];
              const newMin = lastSegment ? lastSegment.max + 1 : 1;
              const newMax = newMin + 5;
              
              this.plugin.settings.heatmapColorSegments.push({
                min: newMin,
                max: newMax,
                color: '#40c463'
              });
              
              await this.plugin.saveSettings();
              this.renderCurrentTab();
            });
        });
      });
    }
  };

}
