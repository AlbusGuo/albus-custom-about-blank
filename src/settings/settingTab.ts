import {
  type App,
  getIconIds,
  Notice,
  PluginSettingTab,
  Setting,
  SettingGroup,
  setIcon,
  type TextComponent,
} from "obsidian";

import {
  ACTION_KINDS,
  type Action,
} from "src/settings/action-basic";

import {
  makeSettingsActionsList,
} from "src/settings/action-settings";

import {
  createNewAction,
} from "src/settings/action-basic";

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

import {
  StringSuggesterAsync,
} from "src/ui/stringSuggesterAsync";

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
  logoEnabled: boolean;
  logoPath: string;
  logoDirectory: string;
  logoStyle: string;
  logoSize: number;
  logoOpacity: number;
  
  showStats: boolean;
  obsidianStartDate: string;
  heatmapEnabled: boolean;
  heatmapDataSource: string;
  heatmapFrontmatterField: string;
  heatmapColorSegments: Array<{min: number, max: number, color: string}>;
  customStats: Array<{
    type: "folder" | "fileType";
    value: string;
    displayName: string;
  }>;
  statOrder: string[];
  actions: Action[];
  settingsTab: string;
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
  logoEnabled: false,
  logoPath: "",
  logoDirectory: "",
  logoStyle: "mask",
  logoSize: 40,
  logoOpacity: 0.4,
  
  showStats: false,
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
  settingsTab: "basic",
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
  logoSize: {
    min: 20,
    max: 1000,
  },
  logoOpacity: {
    min: 0,
    max: 1,
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
  logoEnabled: (value: unknown) => isBool(value),
  logoPath: (value: unknown) => typeof value === "string",
  logoDirectory: (value: unknown) => typeof value === "string",
  logoStyle: (value: unknown) => {
    return typeof value === "string" && ["mask", "original"].includes(value);
  },
  logoSize: (value: unknown) => {
    const limit = DEFAULT_SETTINGS_LIMIT.logoSize;
    if (!limit || !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min >= limit.max) {
      return false;
    }
    if (!Number.isFinite(value)) {
      return false;
    }
    const num = value as number;
    return limit.min <= num && num <= limit.max;
  },
  logoOpacity: (value: unknown) => {
    const limit = DEFAULT_SETTINGS_LIMIT.logoOpacity;
    if (!limit || !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min >= limit.max) {
      return false;
    }
    if (!Number.isFinite(value)) {
      return false;
    }
    const num = value as number;
    return limit.min <= num && num <= limit.max;
  },
  heatmapEnabled: (value: unknown) => isBool(value),
  heatmapDataSource: (value: unknown) => {
    return typeof value === "string" && ["frontmatter", "fileCreation"].includes(value);
  },
  heatmapFrontmatterField: (value: unknown) => typeof value === "string",
  heatmapColorSegments: (value: unknown) => {
    return Array.isArray(value) && value.every(segment => 
      typeof segment === "object" && segment !== null &&
      typeof segment.min === "number" && typeof segment.max === "number" && typeof segment.color === "string"
    );
  },
  customStats: (value: unknown) => {
    return Array.isArray(value) && value.every(stat => 
      typeof stat === "object" && stat !== null &&
      typeof stat.type === "string" && ["folder", "fileType"].includes(stat.type) &&
      typeof stat.value === "string" &&
      typeof stat.displayName === "string"
    );
  },
  statOrder: (value: unknown) => {
    return Array.isArray(value) && value.every(item => typeof item === "string");
  },
  showStats: (value: unknown) => isBool(value),
  obsidianStartDate: (value: unknown) => typeof value === "string",
  actions: (value: unknown) => Array.isArray(value),
  settingsTab: (value: unknown) => typeof value === "string",
};

// =============================================================================

export const defaultSettingsClone = (): AboutBlankSettings => {
  return objectDeepCopy(DEFAULT_SETTINGS);
};

// =============================================================================

export class AboutBlankSettingTab extends PluginSettingTab {
  plugin: AboutBlank;
  icon: string = 'app-window';
  showAppearanceSettings: boolean = false;
  newActionName: string = "";
  showCleanUpSettings: boolean = false;
  showHeatmapSettings: boolean = false;
  private itemListIdCounter: number = 0;
  private draggedIndex: number | null = null;

  constructor(app: App, plugin: AboutBlank) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ---------------------------------------------------------------------------

  display = (): void => {
    try {
      this.containerEl.empty();
      this.containerEl.addClass('about-blank-setting-ui');

      // 创建标签页导航
      const tabNames = ["basic", "logo", "heatmap", "actions"];
      const tabLabels: Record<string, string> = {
        basic: "基本设置",
        logo: "Logo与统计",
        heatmap: "热力图",
        actions: "按钮"
      };

      const tabsEl = this.containerEl.createEl("div", { cls: "about-blank-settings-tabs" });
      for (const tabName of tabNames) {
        const button = tabsEl.createEl("button", { cls: "about-blank-settings-tab" });
        if (this.plugin.settings.settingsTab === tabName) {
          button.classList.add("about-blank-settings-tab-selected");
        }
        button.textContent = tabLabels[tabName];
        button.onclick = async () => {
          // 更新选中状态
          tabsEl.querySelectorAll('.about-blank-settings-tab').forEach(btn => {
            btn.classList.remove('about-blank-settings-tab-selected');
          });
          button.classList.add('about-blank-settings-tab-selected');
          
          this.plugin.settings.settingsTab = tabName;
          await this.plugin.saveSettings();
          this.renderCurrentTab();
        };
      }

      // 创建内容区域容器
      const contentEl = this.containerEl.createEl("div", { cls: "about-blank-settings-content" });
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
    
    contentEl.empty();

    if (this.plugin.settings.settingsTab === "basic") {
      this.makeSettingsBasic(contentEl as HTMLElement);
    } else if (this.plugin.settings.settingsTab === "logo") {
      this.makeSettingsLogo(contentEl as HTMLElement);
    } else if (this.plugin.settings.settingsTab === "heatmap") {
      this.makeSettingsHeatmap(contentEl as HTMLElement);
    } else if (this.plugin.settings.settingsTab === "actions") {
      this.makeSettingsActions(contentEl as HTMLElement);
    }
  };

  private makeSettingsBasic = (containerEl: HTMLElement): void => {
    const basicGroup = new SettingGroup(containerEl);

    // 隐藏消息
    basicGroup.addSetting((hideMsgSetting) => {
      hideMsgSetting
        .setName("隐藏消息")
        .setDesc("隐藏新标签页中的消息")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.hideMessage)
            .onChange(async (value) => {
              try {
                this.plugin.settings.hideMessage = value;
                await this.plugin.saveSettings();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    });

    // 隐藏默认按钮
    basicGroup.addSetting((hideDefaultSetting) => {
      hideDefaultSetting
        .setName("隐藏默认按钮")
        .setDesc("隐藏新标签页中的默认按钮")
        .addDropdown((dropdown) => {
          dropdown
            .addOption("notHide", "不隐藏")
            .addOption("onlyClose", "仅关闭按钮")
            .addOption("all", "全部")
            .setValue(this.plugin.settings.hideDefaultActions)
            .onChange(async (value: "notHide" | "onlyClose" | "all") => {
              try {
                this.plugin.settings.hideDefaultActions = value;
                await this.plugin.saveSettings();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    });

    // 向新标签页添加按钮
    basicGroup.addSetting((addActionsSetting) => {
      addActionsSetting
        .setName("向新标签页添加按钮")
        .setDesc(
          "如果启用，\"按钮\"将被添加到新标签页中, 更改此设置后, 需要重新加载 Obsidian",
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
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
        });
    });

    // 注册按钮
    basicGroup.addSetting((quickActionsSetting) => {
      quickActionsSetting
        .setName("注册按钮")
        .setDesc(
          "将要添加到新标签页的按钮编译为建议器, 并在 Obsidian 中注册为命令",
        );

      if (this.plugin.settings.quickActions === true) {
        quickActionsSetting.addExtraButton((button) => {
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
                  this.plugin.registerQuickActions();
                }
                this.renderCurrentTab();
              } catch (error) {
                loggerOnError(error, "Error in settings.\n(About Blank)");
              }
            });
          setFakeIconToExButtonIfEmpty(button.extraSettingsEl);
        });
      }

      quickActionsSetting.addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.quickActions)
          .onChange(async (value) => {
            try {
              this.plugin.settings.quickActions = value;
              await this.plugin.saveSettings();
              if (this.plugin.settings.quickActions === true) {
                this.plugin.registerQuickActions();
              } else {
                this.plugin.unregisterQuickActions();
              }
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });
    });
  };

  private makeSettingsLogo = (containerEl: HTMLElement): void => {
    // Logo 设置标题（不在 group 内）
    new Setting(containerEl)
      .setName("Logo 设置")
      .setHeading();

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
            .setDesc("限制只显示指定目录下的图片文件 (留空显示所有图片)")
            .addText((text) => {
              logoDirectoryInput = text;
              text
                .setPlaceholder("")
                .setValue(this.plugin.settings.logoDirectory)
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.logoDirectory = value;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
                
              logoDirectoryInput.inputEl.addEventListener('blur', async () => {
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
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
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.logoPath = value;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
                
              logoTextInput.inputEl.addEventListener('blur', async () => {
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
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
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
            });
        });

        logoGroup.addSetting((logoSizeSetting) => {
          let logoSizeInput: TextComponent;
          logoSizeSetting
            .setName("Logo 大小")
            .setDesc(`设置 Logo 的尺寸 (像素范围: ${DEFAULT_SETTINGS_LIMIT.logoSize?.min}-${DEFAULT_SETTINGS_LIMIT.logoSize?.max})`)
            .addText((text) => {
              logoSizeInput = text;
              text
                .setPlaceholder(`例如: ${DEFAULT_SETTINGS.logoSize}`)
                .setValue(this.plugin.settings.logoSize.toString())
                .onChange(async (value) => {
                  try {
                    const num = adjustInt(parseFloat(value));
                    if (!settingsPropTypeCheck.logoSize(num)) {
                      return;
                    }
                    this.plugin.settings.logoSize = num;
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
                
              logoSizeInput.inputEl.addEventListener('blur', async () => {
                try {
                  const num = adjustInt(parseFloat(logoSizeInput.getValue()));
                  if (!settingsPropTypeCheck.logoSize(num)) {
                    logoSizeInput.setValue(this.plugin.settings.logoSize.toString());
                    return;
                  }
                  this.plugin.settings.logoSize = num;
                  await this.plugin.saveSettings();
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
            .setDesc(`设置Logo的透明度 (范围: ${DEFAULT_SETTINGS_LIMIT.logoOpacity?.min}-${DEFAULT_SETTINGS_LIMIT.logoOpacity?.max})`)
            .addText((text) => {
              logoOpacityInput = text;
              text
                .setPlaceholder(`例如: ${DEFAULT_SETTINGS.logoOpacity}`)
                .setValue(this.plugin.settings.logoOpacity.toString())
                .onChange(async (value) => {
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
                
              logoOpacityInput.inputEl.addEventListener('blur', async () => {
                try {
                  const num = parseFloat(logoOpacityInput.getValue());
                  if (!settingsPropTypeCheck.logoOpacity(num)) {
                    logoOpacityInput.setValue(this.plugin.settings.logoOpacity.toString());
                    return;
                  }
                  this.plugin.settings.logoOpacity = num;
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
            });
        });

      }

    // 统计气泡设置标题（不在 group 内）
    new Setting(containerEl)
      .setName("统计气泡设置")
      .setHeading();

    const statsGroup = new SettingGroup(containerEl);

    // 统计气泡开关
    statsGroup.addSetting((showStatsSetting) => {
      showStatsSetting
        .setName("显示统计气泡")
        .setDesc("在 Logo 周围显示文件统计信息气泡")
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
      // Obsidian 开始使用日期
      statsGroup.addSetting((startDateSetting) => {
            let obsidianStartDateInput: TextComponent;
            startDateSetting
              .setName("Obsidian 开始使用日期")
              .setDesc("用于计算使用 Obsidian 的天数")
              .addText((text) => {
                obsidianStartDateInput = text;
                text
                  .setPlaceholder("例如: 2025-12-19")
                  .setValue(this.plugin.settings.obsidianStartDate)
                  .onChange(async (value) => {
                    try {
                      this.plugin.settings.obsidianStartDate = value;
                    } catch (error) {
                      loggerOnError(error, "设置中出现错误\n(About Blank)");
                    }
                  });
                  
                obsidianStartDateInput.inputEl.addEventListener('blur', async () => {
                  try {
                    await this.plugin.saveSettings();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
              });
          });

      // 自定义统计项目
      const statsContainer = containerEl.createEl('div', { cls: 'about-blank-stats-container' });
      this.plugin.settings.customStats.forEach((stat, index) => {
        statsGroup.addSetting((statSetting) => {
          statSetting.setName(`统计项目 ${index + 1}`);
          statSetting.settingEl.addClass('about-blank-stat-setting');
          
          statSetting.addDropdown((dropdown) => {
            dropdown
              .addOption("folder", "文件夹")
              .addOption("fileType", "文件类型")
              .setValue(stat.type)
              .onChange(async (value: "folder" | "fileType") => {
                this.plugin.settings.customStats[index].type = value;
                await this.plugin.saveSettings();
                this.renderCurrentTab();
              });
          });

          statSetting.addText((text) => {
            text.setPlaceholder(stat.type === 'folder' ? "文件夹路径" : "文件扩展名")
              .setValue(stat.value)
              .onChange(async (value) => {
                this.plugin.settings.customStats[index].value = value;
                await this.plugin.saveSettings();
              });
          });

          statSetting.addText((text) => {
            text.setPlaceholder("显示名称")
              .setValue(stat.displayName)
              .onChange(async (value) => {
                this.plugin.settings.customStats[index].displayName = value;
                await this.plugin.saveSettings();
              });
          });

          statSetting.addExtraButton((button) => {
            button.setIcon("trash")
              .setTooltip("删除")
              .onClick(async () => {
                this.plugin.settings.customStats.splice(index, 1);
                await this.plugin.saveSettings();
                this.renderCurrentTab();
              });
          });
        });
      });

      // 添加新统计项目按钮
      statsGroup.addSetting((addStatsSetting) => {
        addStatsSetting.addButton((button) => {
          button
            .setButtonText("+ 添加统计项目")
            .setCta()
            .onClick(async () => {
              this.plugin.settings.customStats.push({
                type: 'folder',
                value: '',
                displayName: ''
              });
              await this.plugin.saveSettings();
              this.renderCurrentTab();
            });
        });
      });
    }
  };

  private makeSettingsActions = (containerEl: HTMLElement): void => {
    const actionsGroup = new SettingGroup(containerEl);

    // 如果没有按钮，显示空状态提示
    if (this.plugin.settings.actions.length === 0) {
      actionsGroup.addSetting((emptySetting) => {
        emptySetting.setName('还没有添加任何按钮');
        emptySetting.setDesc('点击下方的"添加新按钮"开始创建');
      });
    } else {
      // 为每个按钮创建设置项
      this.plugin.settings.actions.forEach((action, index) => {
        this.createActionSetting(actionsGroup, action, index);
      });
    }

    // 添加新按钮的按钮
    actionsGroup.addSetting((addActionSetting) => {
      addActionSetting.addButton((button) => {
        button
          .setButtonText('+ 添加新按钮')
          .setCta()
          .onClick(async () => {
            const newAction = await createNewAction(this.app, '新按钮');
            if (newAction) {
              this.plugin.settings.actions.push(newAction);
              await this.plugin.saveSettings();
              if (this.plugin.settings.quickActions) {
                this.plugin.registerQuickActions();
              }
              this.renderCurrentTab();
            }
          });
      });
    });
  };

  /**
   * 创建单个按钮的设置项（使用 SettingGroup API）
   */
  private createActionSetting = (actionsGroup: SettingGroup, action: Action, index: number): void => {
    actionsGroup.addSetting((setting) => {
      // 添加 CSS 类用于响应式布局
      setting.settingEl.addClass('about-blank-action-setting');
      
      // 设置标签
      setting.setName('按钮');
      
      // 添加拖拽功能
      this.makeDraggable(setting.settingEl, index);

      // 按钮名称
      setting.addText(text => text
      .setPlaceholder('按钮名称')
      .setValue(action.name)
      .onChange(async (value) => {
        action.name = value;
        await this.plugin.saveSettings();
        if (this.plugin.settings.quickActions) {
          this.plugin.registerQuickActions();
        }
      }));

    // 图标选择器
    this.addIconPicker(setting, action);

    // 按钮类型下拉框
    setting.addDropdown(dropdown => dropdown
      .addOption('command', '命令')
      .addOption('file', '文件')
      .setValue(action.content.kind)
      .onChange(async (value: 'command' | 'file') => {
        if (value === 'command') {
          action.content = {
            kind: ACTION_KINDS.command,
            commandName: '',
            commandId: ''
          };
        } else {
          action.content = {
            kind: ACTION_KINDS.file,
            fileName: '',
            filePath: ''
          };
        }
        await this.plugin.saveSettings();
        this.renderCurrentTab();
      }));

    // 内容输入框
    setting.addText(text => {
      if (action.content.kind === ACTION_KINDS.command) {
        text.setPlaceholder('命令ID')
          .setValue(action.content.commandId);
        
        text.inputEl.addEventListener('click', async () => {
          const commands = (this.app as any).commands.commands;
          const commandList = Object.values(commands).map((cmd: any) => ({
            name: cmd.name,
            value: cmd.id
          }));
          
          const selected = await new StringSuggesterAsync(
            this.app,
            commandList,
            '选择命令...'
          ).openAndRespond();
          
          if (!selected.aborted && action.content.kind === ACTION_KINDS.command) {
            action.content.commandId = selected.result.value;
            action.content.commandName = commandList.find(c => c.value === selected.result.value)?.name || '';
            text.setValue(selected.result.value);
            await this.plugin.saveSettings();
          }
        });
      } else if (action.content.kind === ACTION_KINDS.file) {
        text.setPlaceholder('文件路径')
          .setValue(action.content.filePath);
        
        text.inputEl.addEventListener('click', async () => {
          const files = this.app.vault.getMarkdownFiles();
          const fileList = files.map(file => ({
            name: file.path,
            value: file.path
          }));
          
          const selected = await new StringSuggesterAsync(
            this.app,
            fileList,
            '选择文件...'
          ).openAndRespond();
          
          if (!selected.aborted && action.content.kind === ACTION_KINDS.file) {
            action.content.filePath = selected.result.value;
            action.content.fileName = selected.result.value;
            text.setValue(selected.result.value);
            await this.plugin.saveSettings();
          }
        });
      }

      text.onChange(async (value) => {
        if (action.content.kind === ACTION_KINDS.command) {
          action.content.commandId = value;
        } else if (action.content.kind === ACTION_KINDS.file) {
          action.content.filePath = value;
          action.content.fileName = value;
        }
        await this.plugin.saveSettings();
      });
    });

    // 注册为命令开关
    setting.addToggle(toggle => toggle
      .setTooltip('注册为命令')
      .setValue(action.cmd)
      .onChange(async (value) => {
        action.cmd = value;
        await this.plugin.saveSettings();
        if (this.plugin.settings.quickActions) {
          this.plugin.registerQuickActions();
        }
      }));

    // 删除按钮
    setting.addExtraButton(button => button
      .setIcon('trash')
      .setTooltip('删除按钮')
      .onClick(async () => {
        this.plugin.settings.actions.splice(index, 1);
        await this.plugin.saveSettings();
        if (this.plugin.settings.quickActions) {
          this.plugin.registerQuickActions();
        }
        this.renderCurrentTab();
      }));

      // 添加拖拽手柄
      this.addDragHandle(setting, index);
    });
  };

  /**
   * 添加图标选择器（参考 Custom Ribbon Buttons）
   */
  private addIconPicker = (setting: Setting, action: Action): void => {
    const iconButton = setting.controlEl.createEl('button', {
      cls: 'about-blank-icon-picker-button'
    });

    const iconPreview = iconButton.createDiv({ cls: 'about-blank-icon-picker-preview' });
    
    const updateIconDisplay = (iconName: string) => {
      iconPreview.empty();
      try {
        setIcon(iconPreview, iconName || 'help-circle');
      } catch (error) {
        iconPreview.setText('?');
      }
    };

    updateIconDisplay(action.icon);

    iconButton.addEventListener('click', async () => {
      const iconIds = getIconIds();
      iconIds.unshift('*无图标*');
      
      const response = await new IconSuggesterAsync(
        this.app,
        iconIds,
        action.icon || '图标...'
      ).openAndRespond();
      
      if (!response.aborted) {
        action.icon = response.result === '*无图标*' ? '' : response.result;
        updateIconDisplay(action.icon);
        await this.plugin.saveSettings();
        if (this.plugin.settings.quickActions) {
          this.plugin.registerQuickActions();
        }
      }
    });

    iconButton.setAttribute('aria-label', `图标: ${action.icon || 'help-circle'}`);
  };

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
        this.reorderActions(this.draggedIndex, index);
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
    if (this.plugin.settings.quickActions) {
      this.plugin.registerQuickActions();
    }
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
            text.inputEl.style.width = "80px";
          });

          segmentSetting.addText((text) => {
            text.setPlaceholder("最大值")
              .setValue(segment.max.toString())
              .onChange(async (value) => {
                this.plugin.settings.heatmapColorSegments[i].max = parseInt(value) || 0;
                await this.plugin.saveSettings();
              });
            text.inputEl.style.width = "80px";
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
