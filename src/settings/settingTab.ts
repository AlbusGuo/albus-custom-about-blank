import {
  type App,
  getIconIds,
  Notice,
  PluginSettingTab,
  Setting,
  type TextComponent,
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
  showHeatmapSettings: boolean = false;

  constructor(app: App, plugin: AboutBlank) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ---------------------------------------------------------------------------

  display = (): void => {
    try {
      this.containerEl.empty();

      this.makeSettingsBasic();
      this.makeSettingsAddActions();
      this.makeSettingsQuickActions();
      this.makeSettingsLogo();
      this.makeSettingsStats();
      this.makeSettingsHeatmap();
      makeSettingsActionsHeader(
        this.containerEl,
        this,
        this.plugin.settings,
        true,
        null,
        "按钮",
        "这些按钮可以添加到新标签页中",
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

  private makeSettingsBasic = (): void => {
    new Setting(this.containerEl)
      .setHeading()
      .setName("基本设置");

    // 移动隐藏消息设置到基本设置
    new Setting(this.containerEl)
      .setName("隐藏消息")
      .setDesc("隐藏新标签页中的消息")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.hideMessage)
          .onChange(async (value) => {
            try {
              this.plugin.settings.hideMessage = value;
              await this.plugin.saveSettings();
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });

    // 移动隐藏默认操作设置到基本设置
    new Setting(this.containerEl)
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
              this.display();
            } catch (error) {
              loggerOnError(error, "Error in settings.\n(About Blank)");
            }
          });
      });
  };

  private makeSettingsAddActions = (): void => {
    new Setting(this.containerEl)
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
      .setName("注册按钮")
      .setDesc(
        "将要添加到新标签页的按钮编译为建议器, 并在 Obsidian 中注册为命令",
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

  private makeSettingsLogo = (): void => {
    new Setting(this.containerEl)
      .setHeading()
      .setName("Logo 设置");

      

      

      new Setting(this.containerEl)
        .setName("启用 Logo")
        .setDesc("在新标签页显示自定义 Logo 图片")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.logoEnabled)
            .onChange(async (value) => {
              try {
                this.plugin.settings.logoEnabled = value;
                await this.plugin.saveSettings();
                this.display();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });

      if (this.plugin.settings.logoEnabled) {
        // 添加Logo文件目录设置（放在Logo图片路径上方）
        let logoDirectoryInput: TextComponent;
        new Setting(this.containerEl)
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
                // 不在这里调用saveSettings，避免输入框退出
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
            
            // 添加输入框失焦保存
            logoDirectoryInput.inputEl.addEventListener('blur', async () => {
              try {
                await this.plugin.saveSettings();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });

        let logoTextInput: TextComponent;
          
          const logoPathSetting = new Setting(this.containerEl)
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
                  // 不在这里调用saveSettings，避免输入框退出
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
              
              // 添加输入框失焦保存
              logoTextInput.inputEl.addEventListener('blur', async () => {
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
          
          logoPathSetting.addButton((button) => {
            button
              .setButtonText("选择文件")
              .onClick(async () => {
                try {
                  // 使用插件中的文件选择方法
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

        new Setting(this.containerEl)
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

        // Logo大小输入框
        let logoSizeInput: TextComponent;
        new Setting(this.containerEl)
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
                  // 不在这里调用saveSettings，避免输入框退出
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
              
              // 添加输入框失焦保存
              logoSizeInput.inputEl.addEventListener('blur', async () => {
                try {
                  const num = adjustInt(parseFloat(logoSizeInput.getValue()));
                  if (!settingsPropTypeCheck.logoSize(num)) {
                    // 如果输入无效，恢复为默认值
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

        // Logo透明度输入框
        let logoOpacityInput: TextComponent;
        new Setting(this.containerEl)
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
                  // 不在这里调用saveSettings，避免输入框退出
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
              
              // 添加输入框失焦保存
              logoOpacityInput.inputEl.addEventListener('blur', async () => {
                try {
                  const num = parseFloat(logoOpacityInput.getValue());
                  if (!settingsPropTypeCheck.logoOpacity(num)) {
                    // 如果输入无效，恢复为默认值
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

        
      
    }
  };

  private makeSettingsStats = (): void => {
    new Setting(this.containerEl)
      .setHeading()
      .setName("统计设置")
      .setDesc("配置 Logo 周围的统计气泡显示");
    
    // 统计气泡开关
    new Setting(this.containerEl)
      .setName("显示统计气泡")
      .setDesc("在 Logo 周围显示文件统计信息气泡")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showStats)
          .onChange(async (value) => {
            try {
              this.plugin.settings.showStats = value;
              await this.plugin.saveSettings();
              this.display();
            } catch (error) {
              loggerOnError(error, "设置中出现错误\n(About Blank)");
            }
          });
      });

    if (this.plugin.settings.showStats) {
      // Obsidian 开始使用日期
      let obsidianStartDateInput: TextComponent;
      new Setting(this.containerEl)
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
                // 不在这里调用saveSettings，避免输入框退出
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
            
          // 添加输入框失焦保存
          obsidianStartDateInput.inputEl.addEventListener('blur', async () => {
            try {
              await this.plugin.saveSettings();
            } catch (error) {
              loggerOnError(error, "设置中出现错误\n(About Blank)");
            }
          });
        });
      // 自定义统计项目设置
      new Setting(this.containerEl)
        .setName("自定义统计项目")
        .setDesc("配置要显示的统计信息, 支持文件夹、标签和文件类型统计");

      // 创建一个容器来包裹动态的统计项目设置
      const statsContainer = this.containerEl.createEl('div', { cls: 'about-blank-stats-container' });

      // 渲染现有统计项目
      const renderStatsList = () => {
        // 清空容器而不是移除所有设置项
        statsContainer.empty();
        
        if (this.plugin.settings.customStats.length === 0) {
          const emptyState = statsContainer.createEl('div', { 
            cls: 'setting-item-description'
          });
          emptyState.style.marginTop = '-10px';
          emptyState.style.marginBottom = '15px';
          emptyState.style.color = 'var(--text-muted)';
          emptyState.textContent = '暂无自定义统计项目, 点击下方按钮添加';
          return;
        }
        
        this.plugin.settings.customStats.forEach((stat, index) => {
          const settingItem = new Setting(statsContainer)
            .setClass('about-blank-custom-stat-setting');
          
          settingItem.setName(`统计项目 ${index + 1}`);
          
          // 类型选择
          settingItem.addDropdown((dropdown) => {
            dropdown
              .addOption("folder", "文件夹")
              .addOption("fileType", "文件类型")
              .setValue(stat.type)
              .onChange(async (value: "folder" | "fileType") => {
                try {
                  this.plugin.settings.customStats[index].type = value;
                  await this.plugin.saveSettings();
                  renderStatsList();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
          
          // 值输入或选择
          if (stat.type === 'folder') {
            settingItem.addText((text) => {
              text
                .setPlaceholder("点击选择文件夹")
                .setValue(stat.value || "点击选择文件夹")
                .onChange(async (value) => {
                  // 防止直接输入，只响应选择操作
                  if (value !== stat.value) {
                    text.setValue(stat.value || "点击选择文件夹");
                  }
                });
              
              // 保持输入框默认样式，只添加点击事件
              const inputEl = text.inputEl;
              inputEl.style.cursor = 'pointer';
              
              // 添加点击事件
              inputEl.addEventListener('click', async () => {
                try {
                  const selectedPath = await this.plugin.showFolderSelectionDialog();
                  if (selectedPath) {
                    this.plugin.settings.customStats[index].value = selectedPath;
                    await this.plugin.saveSettings();
                    inputEl.value = selectedPath;
                  }
                } catch (error) {
                  loggerOnError(error, "文件夹选择失败\n(About Blank)");
                  new Notice("文件夹选择失败, 请手动输入文件夹路径", 5000);
                }
              });
            });
          } else if (stat.type === 'fileType') {
            settingItem.addText((text) => {
              text
                .setPlaceholder("文件扩展名")
                .setValue(stat.value)
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.customStats[index].value = value;
                    // 不在这里调用saveSettings，避免输入框退出
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
              
              // 添加输入框失焦保存
              text.inputEl.addEventListener('blur', async () => {
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
            });
          }
          
          // 显示名称输入
          settingItem.addText((text) => {
            text
              .setPlaceholder("显示名称")
              .setValue(stat.displayName)
              .onChange(async (value) => {
                try {
                  this.plugin.settings.customStats[index].displayName = value;
                  // 不在这里调用saveSettings，避免输入框退出
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
              
            // 添加输入框失焦保存
            text.inputEl.addEventListener('blur', async () => {
              try {
                await this.plugin.saveSettings();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
          });
          
          // 删除按钮
          settingItem.addButton((button) => {
            button
              .setButtonText("删除")
              .setCta()
              .onClick(async () => {
                try {
                  this.plugin.settings.customStats.splice(index, 1);
                  await this.plugin.saveSettings();
                  renderStatsList();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
        });
      };
      
      renderStatsList();
      
      // 添加新统计项目按钮
      new Setting(this.containerEl)
        .addButton((button) => {
          button
            .setButtonText("+ 添加统计项目")
            .setCta()
            .onClick(async () => {
              try {
                this.plugin.settings.customStats.push({
                  type: 'folder',
                  value: '',
                  displayName: ''
                });
                await this.plugin.saveSettings();
                renderStatsList();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });
    }
  };

  private makeSettingsHeatmap = (): void => {
    new Setting(this.containerEl)
      .setHeading()
      .setName("热力图设置")
      .setDesc("配置新标签页中的文件数量热力图显示");
    
    // 热力图设置
    new Setting(this.containerEl)
      .setName("启用热力图")
      .setDesc("在新标签页显示文件数量热力图")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.heatmapEnabled)
          .onChange(async (value) => {
            try {
              this.plugin.settings.heatmapEnabled = value;
              await this.plugin.saveSettings();
              this.display();
            } catch (error) {
              loggerOnError(error, "设置中出现错误\n(About Blank)");
            }
          });
      });

    if (this.plugin.settings.heatmapEnabled) {
      new Setting(this.containerEl)
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
                this.display();
              } catch (error) {
                loggerOnError(error, "设置中出现错误\n(About Blank)");
              }
            });
        });

      if (this.plugin.settings.heatmapDataSource === "frontmatter") {
        new Setting(this.containerEl)
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
      }

      // 颜色分段设置
      new Setting(this.containerEl)
        .setName("颜色分段设置")
        .setDesc("配置不同笔记数量对应的颜色，零值分段使用背景色");

      // 添加零值分段提示
      const zeroSegmentDesc = this.containerEl.createEl('div', { cls: 'setting-item-description' });
      zeroSegmentDesc.textContent = '零值分段（无文件）使用背景色，无需设置';
      zeroSegmentDesc.style.marginTop = '-10px';
      zeroSegmentDesc.style.marginBottom = '10px';
      zeroSegmentDesc.style.color = 'var(--text-muted)';

      // 创建一个容器来包裹动态的颜色分段设置
      const colorSegmentsContainer = this.containerEl.createEl('div', { cls: 'about-blank-color-segments-container' });

      // 渲染颜色分段设置（跳过零值分段）
      const renderColorSegments = () => {
        // 清空容器而不是移除所有设置项
        colorSegmentsContainer.empty();
        
        // 从索引1开始，跳过零值分段
        for (let i = 1; i < this.plugin.settings.heatmapColorSegments.length; i++) {
          const segment = this.plugin.settings.heatmapColorSegments[i];
          const settingItem = new Setting(colorSegmentsContainer)
            .setClass('about-blank-color-segment-setting');
          
          settingItem
            .setName(`分段 ${i}`) // 从1开始计数
            .addText((text) => {
              text
                .setPlaceholder("最小值")
                .setValue(segment.min.toString())
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.heatmapColorSegments[i].min = parseInt(value) || 0;
                    // 不在这里调用saveSettings，避免输入框退出
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
              
              // 添加输入框失焦保存
              text.inputEl.addEventListener('blur', async () => {
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
            })
            .addText((text) => {
              text
                .setPlaceholder("最大值")
                .setValue(segment.max.toString())
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.heatmapColorSegments[i].max = parseInt(value) || 0;
                    // 不在这里调用saveSettings，避免输入框退出
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
              
              // 添加输入框失焦保存
              text.inputEl.addEventListener('blur', async () => {
                try {
                  await this.plugin.saveSettings();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
            })
            .addColorPicker((colorPicker) => {
              colorPicker
                .setValue(segment.color.startsWith('#') ? segment.color : '#40c463')
                .onChange(async (value) => {
                  try {
                    this.plugin.settings.heatmapColorSegments[i].color = value;
                    await this.plugin.saveSettings();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
            });
          
          // 添加删除按钮（至少保留零值分段和一个其他分段）
          if (this.plugin.settings.heatmapColorSegments.length > 2) {
            settingItem.addButton((button) => {
              button
                .setButtonText("删除")
                .setCta()
                .onClick(async () => {
                  try {
                    this.plugin.settings.heatmapColorSegments.splice(i, 1);
                    await this.plugin.saveSettings();
                    renderColorSegments();
                  } catch (error) {
                    loggerOnError(error, "设置中出现错误\n(About Blank)");
                  }
                });
            });
          }
        }
        
        // 添加新分段按钮
        new Setting(this.containerEl)
          .addButton((button) => {
            button
              .setButtonText("+ 添加颜色分段")
              .setCta()
              .onClick(async () => {
                try {
                  const lastSegment = this.plugin.settings.heatmapColorSegments[this.plugin.settings.heatmapColorSegments.length - 1];
                  const newMin = lastSegment ? lastSegment.max + 1 : 1;
                  const newMax = newMin + 5;
                  
                  this.plugin.settings.heatmapColorSegments.push({
                    min: newMin,
                    max: newMax,
                    color: '#40c463'
                  });
                  
                  await this.plugin.saveSettings();
                  renderColorSegments();
                } catch (error) {
                  loggerOnError(error, "设置中出现错误\n(About Blank)");
                }
              });
          });
      };

      renderColorSegments();
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
          "检查设置数据、类型或值、重复的命令 ID 等, 并初始化任何异常部分. 更改的详细信息将输出到控制台. 除非触发, 否则这些更改实际上不会保存. 可以通过重新加载 Obsidian 来放弃这些更改",
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
