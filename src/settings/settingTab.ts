import {
  type App,
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
  genNewCmdId,
  newActionClone,
} from "src/settings/action-basic";

import {
  FolderSuggester,
} from "src/ui/folderSuggester";

import {
  ActionEditorModal,
} from "src/settings/actionEditorModal";

import {
  CustomStatEditorModal,
} from "src/settings/customStatEditorModal";

import {
  DateStatEditorModal,
} from "src/settings/dateStatEditorModal";

import {
  type DateStatDefinition,
  DATE_STAT_TYPES,
  createDateStat,
  getDateStatTypeLabel,
} from "src/settings/dateStatTypes";

import {
  countCustomStatFilterConditions,
  CUSTOM_STAT_FILTER_CONJUNCTIONS,
  createCustomStatDefinition,
  type CustomStatDefinition,
} from "src/utils/customStatFilters";

import {
  loggerOnError,
} from "src/commons";

import type AboutBlank from "src/main";

import {
  CustomIconManager,
} from "src/utils/customIconManager";

import {
  ConfirmModal,
} from "src/ui/confirmModal";

import {
  PointerSortController,
} from "src/ui/pointerSort";

// =============================================================================

export class AboutBlankSettingTab extends PluginSettingTab {
  plugin: AboutBlank;
  contentEl!: HTMLElement;
  icon: string = 'app-window';
  private settingsSortController: PointerSortController<HTMLElement> | null = null;
  private customStatEditorModal: CustomStatEditorModal | null = null;
  private customStatEditorIndex: number | null = null;
  private customStatEditorRefreshPending = false;
  private customStatRowElements = new Map<number, HTMLElement>();
  private dateStatEditorModal: DateStatEditorModal | null = null;
  private dateStatEditorIndex: number | null = null;
  private dateStatEditorRefreshPending = false;
  private dateStatRowElements = new Map<number, HTMLElement>();
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
      const { containerEl } = this;

      this.settingsSortController?.destroy();
      this.settingsSortController = null;
      containerEl.empty();
      containerEl.addClass('about-blank-settings-root');

      // 创建标签页导航 - 固定在顶部
      const tabNames = ["shortcuts", "logo", "stats", "heatmap"];
      const tabLabels: Record<string, string> = {
        shortcuts: "快捷方式",
        logo: "Logo",
        stats: "统计项目",
        heatmap: "热力图"
      };

      const tabsEl = containerEl.createDiv({ cls: "about-blank-settings-tabs" });
      for (const tabName of tabNames) {
        const tab = tabsEl.createDiv({ cls: "about-blank-settings-tab" });
        if (this.plugin.settings.settingsTab === tabName) {
          tab.classList.add('is-active');
        }
        tab.setText(tabLabels[tabName]);
        tab.addEventListener("click", () => {
          this.plugin.settings.settingsTab = tabName;
          void this.plugin.saveSettingsSilent().catch((error) => {
            loggerOnError(error, "保存设置页签失败\n(About Blank)");
          });
          this.display();
        });
      }

      // 可滚动内容区域
      const scrollEl = containerEl.createDiv({ cls: "about-blank-settings-scroll" });
      this.contentEl = scrollEl.createDiv({ cls: "about-blank-settings-content" });
      this.renderCurrentTab();
    } catch (error) {
      loggerOnError(error, "Error in settings.\n(About Blank)");
    }
  };

  /**
   * 渲染当前选择的标签页内容
   */
  renderCurrentTab = (): void => {
    const contentEl = this.contentEl;
    if (!contentEl) return;

    const activeActionIndex = this.plugin.settings.settingsTab === "shortcuts"
      ? this.actionEditorIndex
      : null;
    const activeCustomStatIndex = this.plugin.settings.settingsTab === "stats"
      ? this.customStatEditorIndex
      : null;
    const activeDateStatIndex = this.plugin.settings.settingsTab === "stats"
      ? this.dateStatEditorIndex
      : null;
    this.closeActionEditor(false);
    this.closeCustomStatEditor(false);
    this.closeDateStatEditor(false);
    this.settingsSortController?.destroy();
    this.settingsSortController = null;
    contentEl.empty();
    this.actionRowElements.clear();
    this.customStatRowElements.clear();
    this.dateStatRowElements.clear();

    if (this.plugin.settings.settingsTab === "shortcuts") {
      this.makeSettingsShortcuts(contentEl);
      if (activeActionIndex !== null && activeActionIndex < this.plugin.settings.actions.length) {
        this.actionEditorIndex = activeActionIndex;
        requestAnimationFrame(() => {
          this.reopenActionEditor();
        });
      }
    } else if (this.plugin.settings.settingsTab === "logo") {
      this.actionEditorIndex = null;
      this.makeSettingsLogo(contentEl);
    } else if (this.plugin.settings.settingsTab === "stats") {
      this.actionEditorIndex = null;
      this.makeSettingsStats(contentEl);
      if (activeCustomStatIndex !== null && activeCustomStatIndex < this.plugin.settings.customStats.length) {
        this.customStatEditorIndex = activeCustomStatIndex;
        requestAnimationFrame(() => {
          this.reopenCustomStatEditor();
        });
      }
      if (activeDateStatIndex !== null && activeDateStatIndex < this.plugin.settings.dateStats.length) {
        this.dateStatEditorIndex = activeDateStatIndex;
        requestAnimationFrame(() => {
          this.reopenDateStatEditor();
        });
      }
    } else if (this.plugin.settings.settingsTab === "heatmap") {
      this.actionEditorIndex = null;
      this.customStatEditorIndex = null;
      this.dateStatEditorIndex = null;
      this.makeSettingsHeatmap(contentEl);
    } else {
      this.actionEditorIndex = null;
      this.customStatEditorIndex = null;
      this.dateStatEditorIndex = null;
    }
    this.setupSettingsPointerSort();
  };

  private makeSettingsShortcuts = (containerEl: HTMLElement): void => {
    const basicGroup = new SettingGroup(containerEl);

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

    new Setting(containerEl)
      .setName("快捷方式列表")
      .setHeading();

    const actionsGroup = new SettingGroup(containerEl);

    if (this.plugin.settings.actions.length === 0) {
      actionsGroup.addSetting((emptySetting) => {
        emptySetting
          .setName('还没有添加任何快捷方式')
          .setDesc('点击下方按钮开始创建');
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
  };

  private makeSettingsLogo = (containerEl: HTMLElement): void => {
    const logoGroup = new SettingGroup(containerEl);

    // 添加Logo文件目录设置 (放在Logo图片路径上方)
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

  };

  private makeSettingsStats = (containerEl: HTMLElement): void => {
      // 默认统计项标题
      new Setting(containerEl)
        .setName("默认")
        .setHeading();

      const builtinGroup = new SettingGroup(containerEl);

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

      // 文件统计项目标题
      new Setting(containerEl)
        .setName("文件统计")
        .setHeading();

      const customStatsGroup = new SettingGroup(containerEl);

      if (this.plugin.settings.customStats.length === 0) {
        customStatsGroup.addSetting((emptySetting) => {
          emptySetting
            .setName('还没有添加任何文件统计项目')
            .setDesc('点击下方按钮开始创建');
        });
      } else {
        this.plugin.settings.customStats.forEach((stat, index) => {
          customStatsGroup.addSetting((statHeaderSetting) => {
            statHeaderSetting
              .setName(stat.displayName.trim() || `文件统计 ${index + 1}`)
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
                  const confirmed = await ConfirmModal.confirm(this.app, {
                    title: "删除文件统计",
                    message: `确定要删除文件统计 "${stat.displayName.trim() || `文件统计 ${index + 1}`}" 吗?`,
                    confirmText: "删除",
                    cancelText: "取消",
                    danger: true,
                  });
                  if (!confirmed) {
                    return;
                  }
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

            this.makeSettingSortable(statHeaderSetting, "custom-stats", index);

          });
        });
      }

      customStatsGroup.addSetting((addSetting) => {
        addSetting.settingEl.addClass('about-blank-item-add-setting');
        addSetting.controlEl.addClass('about-blank-item-add-container');
        addSetting.addButton((button) => {
          button
            .setButtonText('添加文件统计')
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

      // 日期统计项目标题
      new Setting(containerEl)
        .setName("日期统计")
        .setHeading();

      const dateStatsGroup = new SettingGroup(containerEl);

      if (this.plugin.settings.dateStats.length === 0) {
        dateStatsGroup.addSetting((emptySetting) => {
          emptySetting
            .setName('还没有添加任何日期统计项目')
            .setDesc('点击下方按钮开始创建');
        });
      } else {
        this.plugin.settings.dateStats.forEach((stat, index) => {
          dateStatsGroup.addSetting((statHeaderSetting) => {
            statHeaderSetting
              .setName(stat.title.trim() || `日期统计 ${index + 1}`)
              .setDesc(this.getDateStatSummary(stat));
            statHeaderSetting.settingEl.addClass('about-blank-stat-setting');
            this.dateStatRowElements.set(index, statHeaderSetting.settingEl);

            statHeaderSetting.addExtraButton((button) => {
              button
                .setIcon("pencil")
                .setTooltip("编辑")
                .onClick(() => {
                  this.openDateStatEditor(index);
                });
            });

            statHeaderSetting.addExtraButton((button) => {
              button.setIcon("trash")
                .setTooltip("删除")
                .onClick(async () => {
                  const confirmed = await ConfirmModal.confirm(this.app, {
                    title: "删除日期统计",
                    message: `确定要删除日期统计 "${stat.title.trim() || `日期统计 ${index + 1}`}" 吗?`,
                    confirmText: "删除",
                    cancelText: "取消",
                    danger: true,
                  });
                  if (!confirmed) {
                    return;
                  }
                  const previousEditorIndex = this.dateStatEditorIndex;
                  this.plugin.settings.dateStats.splice(index, 1);
                  if (previousEditorIndex === index) {
                    this.dateStatEditorIndex = null;
                  } else if (previousEditorIndex !== null && previousEditorIndex > index) {
                    this.dateStatEditorIndex = previousEditorIndex - 1;
                  }
                  await this.plugin.saveSettings();
                  this.plugin.refreshAllNewTabs();
                  this.renderCurrentTab();
                });
            });

            this.makeSettingSortable(statHeaderSetting, "date-stats", index);

          });
        });
      }

      dateStatsGroup.addSetting((addSetting) => {
        addSetting.settingEl.addClass('about-blank-item-add-setting');
        addSetting.controlEl.addClass('about-blank-item-add-container');
        addSetting.addButton((button) => {
          button
            .setButtonText('添加日期统计')
            .setClass('about-blank-item-add-btn')
            .onClick(async () => {
              this.plugin.settings.dateStats.push(createDateStat());
              this.dateStatEditorIndex = this.plugin.settings.dateStats.length - 1;
              await this.plugin.saveSettings();
              this.plugin.refreshAllNewTabs();
              this.renderCurrentTab();
            });
        });
      });
  };

  private getDateStatSummary = (stat: DateStatDefinition): string => {
    const typeLabel = getDateStatTypeLabel(stat.type);
    const dateLabel = stat.type === DATE_STAT_TYPES.anniversary
      ? stat.date
      : stat.date;
    return `${typeLabel} - ${dateLabel || "未设置日期"}`;
  };

  private getCustomStatSummary = (stat: CustomStatDefinition): string => {
    const conjunctionText = stat.filters.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.and
      ? "根组条件: 全部满足"
      : "根组条件: 任一满足";
    const countText = `${countCustomStatFilterConditions(stat.filters)} 条条件`;
    return [conjunctionText, countText].join(" - ");
  };

  private openCustomStatEditor = (index: number): void => {
    const stat = this.plugin.settings.customStats[index];
    const rowEl = this.customStatRowElements.get(index);
    if (!stat || !rowEl) {
      return;
    }

    if (this.customStatEditorIndex === index && this.customStatEditorModal) {
      this.closeCustomStatEditor();
      return;
    }

    this.closeCustomStatEditor(false);
    this.customStatEditorIndex = index;
    this.customStatEditorModal = new CustomStatEditorModal(this.app, stat, {
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
      nameEl.setText(stat.displayName.trim() || `文件统计 ${index + 1}`);
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

  // ===========================================================================
  //                              日期统计编辑器
  // ===========================================================================

  private openDateStatEditor = (index: number): void => {
    const stat = this.plugin.settings.dateStats[index];
    const rowEl = this.dateStatRowElements.get(index);
    if (!stat || !rowEl) {
      return;
    }

    if (this.dateStatEditorIndex === index && this.dateStatEditorModal) {
      this.closeDateStatEditor();
      return;
    }

    this.closeDateStatEditor(false);
    this.dateStatEditorIndex = index;
    this.dateStatEditorModal = new DateStatEditorModal(this.app, stat, {
      onChange: async (nextStat: DateStatDefinition) => {
        if (!this.plugin.settings.dateStats[index]) {
          return;
        }
        this.plugin.settings.dateStats[index] = nextStat;
        this.dateStatEditorRefreshPending = true;
        await this.plugin.saveSettingsSilent();
        this.updateDateStatRow(index);
      },
      onClose: () => {
        this.dateStatEditorModal = null;
        this.dateStatEditorIndex = null;
        this.flushDateStatEditorRefresh();
      },
    });
    this.dateStatEditorModal.open();
  };

  private reopenDateStatEditor = (): void => {
    if (this.dateStatEditorIndex === null) {
      return;
    }
    if (!this.dateStatRowElements.has(this.dateStatEditorIndex)) {
      this.dateStatEditorIndex = null;
      return;
    }
    this.openDateStatEditor(this.dateStatEditorIndex);
  };

  private closeDateStatEditor = (clearIndex: boolean = true): void => {
    const modal = this.dateStatEditorModal;
    this.dateStatEditorModal = null;
    if (clearIndex) {
      this.dateStatEditorIndex = null;
    }
    modal?.close();
  };

  private flushDateStatEditorRefresh = (): void => {
    if (!this.dateStatEditorRefreshPending) {
      return;
    }
    this.dateStatEditorRefreshPending = false;
    this.plugin.refreshAllNewTabs();
  };

  private updateDateStatRow = (index: number): void => {
    const rowEl = this.dateStatRowElements.get(index);
    const stat = this.plugin.settings.dateStats[index];
    if (!rowEl || !stat) {
      return;
    }

    const nameEl = rowEl.querySelector('.setting-item-name');
    if (nameEl) {
      nameEl.setText(stat.title.trim() || `日期统计 ${index + 1}`);
    }

    const summary = this.getDateStatSummary(stat);
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

  // ===========================================================================

  /**
   * 创建单个按钮的设置项 (使用 SettingGroup API)
   */
  private createActionSetting = (actionsGroup: SettingGroup, action: Action, index: number): void => {
    actionsGroup.addSetting((setting) => {
      setting.settingEl.addClass('about-blank-action-setting');
      setting.settingEl.dataset.index = index.toString();
      setting.setName(action.name.trim() || `快捷方式 ${index + 1}`);
      setting.setDesc(this.getActionSummary(action));
      this.actionRowElements.set(index, setting.settingEl);
      this.decorateActionName(setting, action);

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
          const confirmed = await ConfirmModal.confirm(this.app, {
            title: '删除快捷方式',
            message: `确定要删除快捷方式 "${action.name.trim() || `快捷方式 ${index + 1}`}" 吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
          });
          if (!confirmed) {
            return;
          }
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

      this.makeSettingSortable(setting, "actions", index);
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
          previewEl.setText(',');
        }
        return;
      }

      try {
        setIcon(previewEl, action.icon);
      } catch {
        previewEl.setText(',');
      }
    };

    void renderPreview();
  }

  private getActionSummary(action: Action): string {
    if (action.content.kind === ACTION_KINDS.command) {
      const target = action.content.commandName || action.content.commandId || '未设置命令';
      return `命令 - ${target}`;
    }
    if (action.content.kind === ACTION_KINDS.file) {
      return `文件 - ${action.content.filePath || '未设置文件'}`;
    }
    return `网页 - ${action.content.url || '未设置网址'}`;
  }

  private openActionEditor(index: number): void {
    const action = this.plugin.settings.actions[index];
    const rowEl = this.actionRowElements.get(index);
    if (!action || !rowEl) {
      return;
    }

    if (this.actionEditorIndex === index && this.actionEditorModal) {
      this.closeActionEditor();
      return;
    }

    this.closeActionEditor(false);
    this.actionEditorIndex = index;
    this.actionEditorModal = new ActionEditorModal(this.app, action, {
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

  private makeSettingSortable = (
    setting: Setting,
    group: "actions" | "custom-stats" | "date-stats",
    index: number,
  ): void => {
    setting.settingEl.addClass(
      "about-blank-draggable-setting",
      "about-blank-pointer-sort-setting",
    );
    setting.settingEl.dataset.sortGroup = group;
    setting.settingEl.dataset.sortIndex = index.toString();
    const dragHandle = setting.controlEl.createDiv({
      cls: ['clickable-icon', 'about-blank-drag-handle'],
      attr: { 'aria-label': '拖拽排序' },
    });
    setIcon(dragHandle, 'grip-vertical');
  };

  private setupSettingsPointerSort = (): void => {
    const sortableRows = this.contentEl.querySelectorAll<HTMLElement>(
      ".about-blank-pointer-sort-setting",
    );
    if (sortableRows.length < 2) {
      return;
    }

    this.settingsSortController = new PointerSortController<HTMLElement>({
      rootEl: this.contentEl,
      itemSelector: ".about-blank-pointer-sort-setting",
      handleSelector: ".about-blank-drag-handle",
      strategy: "vertical",
      movementAxis: "vertical",
      scrollEl: this.contentEl.parentElement,
      getItems: (sourceEl) => {
        const group = sourceEl.dataset.sortGroup;
        return Array.from(this.contentEl.querySelectorAll<HTMLElement>(
          `.about-blank-pointer-sort-setting[data-sort-group="${group}"]`,
        ));
      },
      getId: (itemEl) => {
        return `${itemEl.dataset.sortGroup}:${itemEl.dataset.sortIndex}`;
      },
      onCommit: (orderedIds, sourceId) => {
        void this.commitSettingsSort(orderedIds, sourceId).catch((error) => {
          loggerOnError(error, "保存拖拽顺序失败\n(About Blank)");
        });
      },
    });
  };

  private commitSettingsSort = async (
    orderedIds: string[],
    sourceId: string,
  ): Promise<void> => {
    const group = sourceId.slice(0, sourceId.lastIndexOf(":"));
    const indices = orderedIds.map((id) => Number(id.slice(id.lastIndexOf(":") + 1)));
    if (indices.some((index) => !Number.isInteger(index))) {
      return;
    }

    if (group === "actions") {
      const current = [...this.plugin.settings.actions];
      this.plugin.settings.actions = indices.map((index) => current[index]);
      this.actionEditorIndex = this.remapEditorIndex(this.actionEditorIndex, indices);
    } else if (group === "custom-stats") {
      const current = [...this.plugin.settings.customStats];
      this.plugin.settings.customStats = indices.map((index) => current[index]);
      this.customStatEditorIndex = this.remapEditorIndex(this.customStatEditorIndex, indices);
      this.plugin.syncStatDefinitionOrder("custom");
    } else if (group === "date-stats") {
      const current = [...this.plugin.settings.dateStats];
      this.plugin.settings.dateStats = indices.map((index) => current[index]);
      this.dateStatEditorIndex = this.remapEditorIndex(this.dateStatEditorIndex, indices);
      this.plugin.syncStatDefinitionOrder("date");
    } else {
      return;
    }

    await this.plugin.saveSettingsSilent();
    this.plugin.refreshAllNewTabs();
    this.renderCurrentTab();
  };

  private remapEditorIndex = (
    editorIndex: number | null,
    reorderedOriginalIndices: number[],
  ): number | null => {
    if (editorIndex === null) {
      return null;
    }
    const nextIndex = reorderedOriginalIndices.indexOf(editorIndex);
    return nextIndex >= 0 ? nextIndex : null;
  };

  private makeSettingsHeatmap = (containerEl: HTMLElement): void => {
    const heatmapGroup = new SettingGroup(containerEl);

      heatmapGroup.addSetting((dataSourceSetting) => {
        dataSourceSetting
          .setName("数据来源")
          .setDesc("选择统计文件日期的数据来源")
          .addDropdown((dropdown) => {
            dropdown
              .addOption("frontmatter", "笔记属性")
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
            .setName("笔记属性名称")
            .setDesc("设置用于统计日期的笔记属性名称")
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

      // 颜色分段设置 (跳过零值分段)
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

          // 删除按钮 (至少保留一个分段)
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
        addSegmentSetting.settingEl.addClass('about-blank-item-add-setting');
        addSegmentSetting.controlEl.addClass('about-blank-item-add-container');
        addSegmentSetting.addButton((button) => {
          button
            .setButtonText("添加颜色分段")
            .setClass('about-blank-item-add-btn')
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
  };

}
