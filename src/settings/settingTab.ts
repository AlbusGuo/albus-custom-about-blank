import {
  type App,
  getIconIds,
  Notice,
  PluginSettingTab,
  Setting,
} from "obsidian";

import {
  type Action,
} from "src/settings/action-basic";

import {
  makeSettingsActionsHeader,
  makeSettingsActionsList,
} from "src/settings/action-settings";

import {
  editStyles,
} from "src/settings/editStyles";

import {
  HIDE_DEFAULT_ACTIONS,
  makeSettingsHideDefaults,
} from "src/settings/hideDefault";

import {
  IconSuggesterAsync,
} from "src/ui/iconSuggesterAsync";

import isBool from "src/utils/isBool";

import {
  objectDeepCopy,
} from "src/utils/objectDeepCopy";

import {
  adjustInt,
  loggerOnError,
  setFakeIconToExButtonIfEmpty,
} from "src/commons";

import type AboutBlank from "src/main";

import {
  type ValuesOf,
} from "src/types";

// =============================================================================

export interface AboutBlankSettings {
  addActionsToNewTabs: boolean;
  iconTextGap: number;
  hideMessage: boolean;
  hideDefaultActions: ValuesOf<typeof HIDE_DEFAULT_ACTIONS>;
  centerActionListVertically: boolean;
  deleteActionListMarginTop: boolean;
  quickActions: boolean;
  quickActionsIcon: string;
  actions: Action[];
}

export const DEFAULT_SETTINGS: AboutBlankSettings = {
  addActionsToNewTabs: true,
  iconTextGap: 10,
  hideMessage: false,
  hideDefaultActions: HIDE_DEFAULT_ACTIONS.not,
  centerActionListVertically: false,
  deleteActionListMarginTop: false,
  quickActions: false,
  quickActionsIcon: "",
  actions: [],
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

export const settingsPropTypeCheck: {
  [key in keyof AboutBlankSettings]: (value: unknown) => boolean;
} = {
  addActionsToNewTabs: (value: unknown) => isBool(value),
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
  hideMessage: (value: unknown) => isBool(value),
  hideDefaultActions: (value: unknown) => {
    const correctValues: unknown[] = Object.values(HIDE_DEFAULT_ACTIONS);
    return correctValues.includes(value);
  },
  centerActionListVertically: (value: unknown) => isBool(value),
  deleteActionListMarginTop: (value: unknown) => isBool(value),
  quickActions: (value: unknown) => isBool(value),
  quickActionsIcon: (value: unknown) => typeof value === "string",
  actions: (value: unknown) => Array.isArray(value),
};

// =============================================================================

export const defaultSettingsClone = (): AboutBlankSettings => {
  return objectDeepCopy(DEFAULT_SETTINGS);
};

// =============================================================================

export class AboutBlankSettingTab extends PluginSettingTab {
  plugin: AboutBlank;
  showAppearanceSettings: boolean = false;
  newActionName: string = "";
  switchInfo: boolean = false;
  showCleanUpSettings: boolean = false;

  constructor(app: App, plugin: AboutBlank) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ---------------------------------------------------------------------------

  display = (): void => {
    try {
      this.containerEl.empty();

      this.makeSettingsAddActions();
      this.makeSettingsQuickActions();
      this.makeSettingsAppearance();
      makeSettingsActionsHeader(
        this.containerEl,
        this,
        this.plugin.settings,
        true,
        null,
        "操作",
        "这些操作可以添加到空文件视图（新标签页）中。",
      );
      makeSettingsActionsList(
        this.containerEl,
        this,
        0,
        this.plugin.settings,
        true,
      );
      this.makeSettingsCleanUp();
    } catch (error) {
      loggerOnError(error, "Error in settings.\n(About Blank)");
    }
  };

  private makeSettingsAddActions = (): void => {
    new Setting(this.containerEl)
      .setName("向空文件视图（新标签页）添加操作")
      .setDesc(
        "如果启用，\"操作\"将被添加到空文件视图（新标签页）中。更改此设置后，需要重新加载 Obsidian。",
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.addActionsToNewTabs)
          .onChange(async (value) => {
            try {
              this.plugin.settings.addActionsToNewTabs = value;
              if (value) {
                editStyles.rewriteCssVars.emptyStateDisplay.hide();
              } else {
                editStyles.rewriteCssVars.emptyStateDisplay.default();
              }
              await this.plugin.saveSettings();
              new Notice("重新加载 Obsidian 以应用更改", 0);
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });
  };

  private makeSettingsQuickActions = (): void => {
    const settingItem = new Setting(this.containerEl);
    settingItem
      .setName("快速操作")
      .setDesc(
        "将要添加到空文件视图（新标签页）的操作编译为建议器，并在 Obsidian 中注册为命令。",
      );
    if (this.plugin.settings.quickActions === true) {
      settingItem
        .addExtraButton((button) => {
          button
            .setIcon(this.plugin.settings.quickActionsIcon)
            .setTooltip("设置图标")
            .onClick(async () => {
              try {
                const noIconId = "*无图标*";
                const iconIds = getIconIds();
                iconIds.unshift(noIconId);
                const placeholder = this.plugin.settings.quickActionsIcon
                  ? this.plugin.settings.quickActionsIcon
                  : "图标...";
                const response = await new IconSuggesterAsync(
                  this.app,
                  iconIds,
                  placeholder,
                ).openAndRespond();
                if (response.aborted) {
                  return;
                } else if (response.result === noIconId) {
                  this.plugin.settings.quickActionsIcon = "";
                } else {
                  this.plugin.settings.quickActionsIcon = response.result;
                }
                if (this.plugin.settings.quickActions === true) {
                  this.plugin.registerQuickActions(); // Overwrite
                }
                this.display();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
          setFakeIconToExButtonIfEmpty(button.extraSettingsEl);
        });
    }
    settingItem
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.quickActions)
          .onChange(async (value) => {
            try {
              this.plugin.settings.quickActions = value;
              await this.plugin.saveSettings();
              if (this.plugin.settings.quickActions === true) {
                this.plugin.registerQuickActions(); // Overwrite
              } else {
                this.plugin.unregisterQuickActions();
              }
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });
  };

  private makeSettingsAppearance = (): void => {
    new Setting(this.containerEl)
      .setHeading()
      .setName("外观设置")
      .addExtraButton((button) => {
        const icon = this.showAppearanceSettings ? "chevron-down" : "chevron-left";
        const tooltip = this.showAppearanceSettings ? "隐藏" : "显示";
        button
          .setIcon(icon)
          .setTooltip(tooltip)
          .onClick(() => {
            try {
              this.showAppearanceSettings = !this.showAppearanceSettings;
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
        setFakeIconToExButtonIfEmpty(button.extraSettingsEl);
      });

    if (this.showAppearanceSettings) {
      makeSettingsHideDefaults(
        this.containerEl,
        this,
      );

      const limit = DEFAULT_SETTINGS_LIMIT.iconTextGap;
      new Setting(this.containerEl)
        .setName("图标文本间距")
        .setDesc(
          `空文件视图（新标签页）中操作按钮的图标与文本之间的间距。某些社区主题可能需要调整此值（例如 Border 主题推荐 0px）。<${
            limit?.min ?? ""
          }px - ${limit?.max ?? ""}px (默认: ${DEFAULT_SETTINGS.iconTextGap}px)>`,
        )
        .addSlider((slider) => {
          if (!limit || !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min >= limit.max) {
            return;
          }
          slider
            .setLimits(limit.min, limit.max, 1)
            .setValue(adjustInt(this.plugin.settings.iconTextGap))
            .setDynamicTooltip()
            .onChange(async (value) => {
              try {
                const num = adjustInt(value);
                if (!settingsPropTypeCheck.iconTextGap(num)) {
                  return;
                }
                this.plugin.settings.iconTextGap = num;
                await this.plugin.saveSettings();
                editStyles.rewriteCssVars.iconTextGap.set(num);
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });

      new Setting(this.containerEl)
        .setName("垂直居中操作")
        .setDesc(
          "如果启用，空文件视图（新标签页）中的操作将垂直居中。这可能与某些社区主题不太兼容。",
        )
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.centerActionListVertically)
            .onChange(async (value) => {
              try {
                this.plugin.settings.centerActionListVertically = value;
                if (value) {
                  editStyles.rewriteCssVars.emptyStateContainerMaxHeight.centered();
                } else {
                  editStyles.rewriteCssVars.emptyStateContainerMaxHeight.default();
                }
                await this.plugin.saveSettings();
                this.display();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });

      new Setting(this.containerEl)
        .setName("删除操作上边距（更加居中）")
        .setDesc(
          "如果启用，空文件视图（新标签页）中操作的上边距将被删除。与\"垂直居中操作\"设置结合使用时，会更加居中。",
        )
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.deleteActionListMarginTop)
            .onChange(async (value) => {
              try {
                this.plugin.settings.deleteActionListMarginTop = value;
                if (value) {
                  editStyles.rewriteCssVars.emptyStateListMarginTop.centered();
                } else {
                  editStyles.rewriteCssVars.emptyStateListMarginTop.default();
                }
                await this.plugin.saveSettings();
                this.display();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    }
  };

  private makeSettingsCleanUp = (): void => {
    const settingItem = new Setting(this.containerEl);
    settingItem
      .setHeading()
      .setName("清理设置");
    if (this.showCleanUpSettings) {
      settingItem
        .setDesc(
          "检查设置数据、类型或值、重复的命令 ID 等，并初始化任何异常部分。更改的详细信息将输出到控制台。除非触发，否则这些更改实际上不会保存。可以通过重新加载 Obsidian 来放弃这些更改。",
        )
        .addButton((button) => {
          button
            .setWarning()
            .setButtonText("清理")
            .onClick(() => {
              try {
                this.plugin.cleanUpSettings();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    }
    settingItem
      .addExtraButton((button) => {
        const icon = this.showCleanUpSettings ? "chevron-down" : "chevron-left";
        const tooltip = this.showCleanUpSettings ? "Hide" : "Show";
        button
          .setIcon(icon)
          .setTooltip(tooltip)
          .onClick(() => {
            try {
              this.showCleanUpSettings = !this.showCleanUpSettings;
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
        setFakeIconToExButtonIfEmpty(button.extraSettingsEl);
      });
  };
}
